import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { TikTokConnectorService } from './tiktok-connector.service';
import { imageUrl } from './tiktok-lives.types';

const MAX_FEEDS = 20;
const IDLE_MS = 90_000;
const RETRY_MS = 60_000;
const MAX_COMMENTS = 80;

export interface FeedComment {
  id: string;
  name: string;
  handle: string | null;
  avatar: string | null;
  text: string;
  at: number;
}

export interface FeedPin {
  id: string;
  name: string;
  text: string;
  at: number;
}

export interface FeedProduct {
  title: string;
  price: string | null;
  image: string | null;
  url: string | null;
}

export type FeedStatus = 'connecting' | 'live' | 'ended' | 'unavailable';

interface Feed {
  roomId: string;
  status: FeedStatus;
  viewers: number | null;
  likes: number | null;
  shares: number;
  comments: FeedComment[];
  pins: FeedPin[];
  products: FeedProduct[];
  lastSeen: number;
  failedAt: number;
  close?: () => Promise<void>;
}

export interface FeedSnapshot {
  status: FeedStatus;
  viewers: number | null;
  likes: number | null;
  shares: number;
  comments: FeedComment[];
  pins: FeedPin[];
  products: FeedProduct[];
}

const text = (value: unknown, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const count = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

/**
 * Follows a TikTok room while someone watches it in Vitrina: real comments, likes, viewers,
 * pinned messages and TikTok Shop products. Sockets open on demand and close when nobody asks.
 */
@Injectable()
export class LiveFeedService implements OnModuleDestroy {
  private readonly logger = new Logger(LiveFeedService.name);
  private readonly feeds = new Map<string, Feed>();

  constructor(private readonly connector: TikTokConnectorService) {}

  /** Current state of the room; starts following it if nobody was. */
  snapshot(username: string, roomId: string, afterId?: string): FeedSnapshot {
    let feed = this.feeds.get(username);
    if (feed && feed.roomId !== roomId) {
      void feed.close?.();
      this.feeds.delete(username);
      feed = undefined;
    }
    if (!feed) feed = this.start(username, roomId);
    else if (feed.status === 'unavailable' && Date.now() - feed.failedAt > RETRY_MS) this.connect(username, feed);
    feed.lastSeen = Date.now();

    const from = afterId ? feed.comments.findIndex((c) => c.id === afterId) : -1;
    return {
      status: feed.status,
      viewers: feed.viewers,
      likes: feed.likes,
      shares: feed.shares,
      comments: from >= 0 ? feed.comments.slice(from + 1) : feed.comments,
      pins: feed.pins,
      products: feed.products,
    };
  }

  private start(username: string, roomId: string): Feed {
    const feed: Feed = {
      roomId,
      status: 'connecting',
      viewers: null,
      likes: null,
      shares: 0,
      comments: [],
      pins: [],
      products: [],
      lastSeen: Date.now(),
      failedAt: 0,
    };
    if (this.feeds.size >= MAX_FEEDS) {
      feed.status = 'unavailable';
      feed.failedAt = Date.now();
      return feed;
    }
    this.feeds.set(username, feed);
    this.connect(username, feed);
    return feed;
  }

  private connect(username: string, feed: Feed) {
    feed.status = 'connecting';
    const mine = () => this.feeds.get(username) === feed;
    this.connector
      .openFeed(username, feed.roomId, {
        chat: (m) => {
          const body = text(m?.content);
          if (!body) return;
          feed.comments.push({
            id: String(m?.common?.msgId ?? `${Date.now()}-${feed.comments.length}`),
            name: text(m?.user?.nickname, 60) || 'Usuario',
            handle: text(m?.user?.displayId, 40) || null,
            avatar: imageUrl(m?.user?.avatarThumb?.urlList?.[0]) ?? null,
            text: body,
            at: Number(m?.common?.createTime) || Date.now(),
          });
          if (feed.comments.length > MAX_COMMENTS) feed.comments.splice(0, feed.comments.length - MAX_COMMENTS);
        },
        like: (m) => {
          const total = count(m?.total);
          if (total !== null) feed.likes = Math.max(feed.likes ?? 0, total);
        },
        viewers: (m) => {
          const total = count(m?.total ?? m?.viewerCount);
          if (total !== null) feed.viewers = total;
        },
        share: () => {
          feed.shares += 1;
        },
        pin: (m) => {
          const body = text(m?.chatMessage?.content);
          const id = String(m?.pinId ?? m?.common?.msgId ?? '');
          if (!body || !id || feed.pins.some((p) => p.id === id)) return;
          feed.pins.unshift({
            id,
            name: text(m?.chatMessage?.user?.nickname, 60) || 'La tienda',
            text: body,
            at: Number(m?.pinTime ?? m?.common?.createTime) || Date.now(),
          });
          feed.pins.splice(10);
        },
        product: (m) => {
          const title = text(m?.shopData?.title, 120);
          if (!title || feed.products.some((p) => p.title === title)) return;
          feed.products.unshift({
            title,
            price: text(m?.shopData?.priceString, 30) || null,
            image: imageUrl(m?.shopData?.imageUrl) ?? null,
            url: imageUrl(m?.shopData?.shopUrl) ?? null,
          });
          feed.products.splice(30);
        },
        ended: () => {
          feed.status = 'ended';
          void feed.close?.();
        },
        disconnected: () => {
          if (feed.status === 'live' && mine()) {
            feed.status = 'unavailable';
            feed.failedAt = Date.now();
          }
        },
      })
      .then((close) => {
        if (!mine() || feed.status === 'ended') return void close();
        feed.close = close;
        feed.status = 'live';
      })
      .catch(() => {
        feed.status = 'unavailable';
        feed.failedAt = Date.now();
        this.logger.debug(`No se pudo seguir la sala de @${username}`);
      });
  }

  /** Closes rooms nobody has looked at for a while. */
  @Interval(30_000)
  sweep(now = Date.now()) {
    for (const [username, feed] of this.feeds) {
      if (now - feed.lastSeen < IDLE_MS) continue;
      this.feeds.delete(username);
      void feed.close?.();
    }
  }

  async onModuleDestroy() {
    await Promise.allSettled([...this.feeds.values()].map((f) => f.close?.()));
    this.feeds.clear();
  }
}
