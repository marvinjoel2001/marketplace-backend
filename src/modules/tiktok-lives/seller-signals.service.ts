import { Injectable, Logger } from '@nestjs/common';
import { EcommerceClassifier } from './ecommerce-classifier.service';
import { ChatSample, judgeCaptions, judgeChat } from './seller-signals';
import { TikTokConnectorService } from './tiktok-connector.service';
import { TikTokDiscoveryService } from './tiktok-discovery.service';
import { TikTokLivesConfig } from './tiktok-lives.config';
import { TikTokLivesService } from './tiktok-lives.service';
import { LiveCandidate, RetryGate } from './tiktok-lives.types';

/** Video captions change slowly: re-read an account's videos at most every 3 days. */
const VIDEO_RECHECK_MS = 3 * 24 * 3600 * 1000;
/** A room whose chat was quiet is sampled again after this long (sales often start later). */
const CHAT_RECHECK_MS = 20 * 60 * 1000;
/** Undecided lives older than this are dropped from the queue (they have probably ended). */
const QUEUE_TTL_MS = 10 * 60 * 1000;
const QUEUE_MAX = 300;
const MAX_ATTEMPTS = 2;

interface Pending {
  live: LiveCandidate;
  seenAt: number;
  chatAttempts: number;
}

/**
 * Second look at lives whose title doesn't say they sell: reads the account's recent video
 * captions and listens to the live chat for buyers ("mío", "precio?", "cuánto", "talla M") or
 * TikTok Shop products. Evidence is stored in TikTokSellerSignal and used by the classifier.
 */
@Injectable()
export class SellerSignalsService {
  private readonly logger = new Logger(SellerSignalsService.name);
  private readonly queue = new Map<string, Pending>();
  private readonly socketGate = new RetryGate(60000, 600000);
  private socketFailures = 0;

  constructor(
    private readonly config: TikTokLivesConfig,
    private readonly lives: TikTokLivesService,
    private readonly discovery: TikTokDiscoveryService,
    private readonly connector: TikTokConnectorService,
    private readonly classifier: EcommerceClassifier,
  ) {}

  get pending(): number {
    return this.queue.size;
  }

  /** Lives seen in the feed that are neither clearly selling nor gaming/music. */
  enqueue(lives: LiveCandidate[], now = Date.now()): void {
    for (const live of lives) {
      const previous = this.queue.get(live.username);
      this.queue.delete(live.username); // Re-insert: most recently seen goes last.
      this.queue.set(live.username, {
        live: { ...previous?.live, ...live },
        seenAt: now,
        chatAttempts: previous?.live.roomId === live.roomId ? previous.chatAttempts : 0,
      });
    }
    while (this.queue.size > QUEUE_MAX) this.queue.delete(this.queue.keys().next().value);
  }

  /** Checks a batch of the queue; resolves with the lives that turned out to be selling. */
  async inspect(owned: () => boolean = () => true, now = Date.now()): Promise<{ live: LiveCandidate; seenAt: number }[]> {
    for (const [username, entry] of this.queue)
      if (now - entry.seenAt > QUEUE_TTL_MS) this.queue.delete(username);
    if (!this.queue.size) return [];
    const entries = [...this.queue.values()];
    const checks = await this.lives.signalChecks(entries.map((e) => e.live.username));
    const byAudience = [...entries].sort((a, b) => b.live.viewerCount - a.live.viewerCount);

    const videoDue = (e: Pending) => {
      const at = checks.get(e.live.username)?.videoCheckedAt?.getTime() ?? 0;
      return now - at > VIDEO_RECHECK_MS;
    };
    const chatDue = (e: Pending) => {
      if (!e.live.roomId || e.chatAttempts >= MAX_ATTEMPTS) return false;
      const check = checks.get(e.live.username);
      return check?.chatRoomId !== e.live.roomId || now - (check.chatCheckedAt?.getTime() ?? 0) > CHAT_RECHECK_MS;
    };
    const profiles = byAudience.filter(videoDue).slice(0, this.config.profileChecksPerCycle);
    const chats = this.config.maxConnections === 0 || !this.socketGate.ready('chat')
      ? []
      : byAudience.filter(chatDue).slice(0, this.config.chatSamplesPerCycle);

    const recorded = { videos: new Set<string>(), chats: new Set<string>() };
    await Promise.all([
      this.checkVideos(profiles, owned, recorded.videos),
      Promise.all(chats.map((entry) => this.checkChat(entry, owned, recorded.chats))),
    ]);

    // Classify again with whatever was found; an entry leaves the queue once it sells or
    // nothing is left to check for it.
    const signals = await this.lives.signalsFor(entries.map((e) => e.live.username));
    const selling: { live: LiveCandidate; seenAt: number }[] = [];
    for (const entry of entries) {
      const username = entry.live.username;
      if (this.classifier.classify(entry.live, false, signals.get(username)).isSelling) {
        selling.push({ live: entry.live, seenAt: entry.seenAt });
        this.queue.delete(username);
        continue;
      }
      const videoPending = videoDue(entry) && !recorded.videos.has(username);
      const chatPending = chatDue(entry) && !recorded.chats.has(username);
      if (!videoPending && !chatPending) this.queue.delete(username);
    }
    if (profiles.length || chats.length)
      this.logger.log(
        `Señales de venta: ${profiles.length} perfiles y ${chats.length} chats revisados, ${selling.length} vendedores nuevos`,
      );
    return selling;
  }

  private async checkVideos(entries: Pending[], owned: () => boolean, recorded: Set<string>): Promise<void> {
    if (!entries.length || !owned()) return;
    const profiles = await this.discovery
      .scanProfiles(entries.map((e) => e.live.username))
      .catch(() => new Map<string, { captions: string[]; bio?: string }>());
    for (const entry of entries) {
      const profile = profiles.get(entry.live.username);
      if (!profile) continue; // Not reached (block/interrupt): retried on a later pass.
      if (profile.bio && !entry.live.bio) entry.live.bio = profile.bio;
      const verdict = judgeCaptions(profile.captions);
      await this.lives.recordVideoSignal(entry.live.username, verdict.selling, verdict.keywords);
      recorded.add(entry.live.username);
    }
  }

  private async checkChat(entry: Pending, owned: () => boolean, recorded: Set<string>): Promise<void> {
    const { username, roomId } = entry.live;
    if (!roomId || !owned()) return;
    entry.chatAttempts += 1;
    const sample = await this.sampleChat(username, roomId);
    if (!sample) return;
    const verdict = judgeChat(sample, username, this.config.chatMinBuyerComments);
    await this.lives.recordChatSignal(username, roomId, verdict.selling, verdict.hits);
    recorded.add(username);
  }

  /** Listens to a room's chat for a while; null when the socket could not be opened. */
  async sampleChat(username: string, roomId: string): Promise<ChatSample | null> {
    const sample: ChatSample = { comments: [], products: 0, pins: [] };
    let finish: () => void = () => undefined;
    const done = new Promise<void>((resolve) => (finish = resolve));
    const enough = () => judgeChat(sample, username, this.config.chatMinBuyerComments).selling;
    let close: (() => Promise<void>) | undefined;
    try {
      close = await this.connector.openFeed(username, roomId, {
        chat: (m) => {
          const text = typeof m?.content === 'string' ? m.content.slice(0, 300) : '';
          if (!text || sample.comments.length >= 400) return;
          sample.comments.push({ user: String(m?.user?.uniqueId ?? m?.user?.displayId ?? ''), text });
          if (enough()) finish();
        },
        like: () => undefined,
        viewers: () => undefined,
        share: () => undefined,
        pin: (m) => {
          const text = m?.chatMessage?.content;
          if (typeof text === 'string') sample.pins.push(text.slice(0, 300));
          if (enough()) finish();
        },
        product: () => {
          sample.products += 1;
          finish();
        },
        ended: () => finish(),
        disconnected: () => finish(),
      });
      this.socketFailures = 0;
      this.socketGate.success('chat');
    } catch {
      // Signing-provider limits or blocks: pause sampling instead of hammering it.
      if (++this.socketFailures >= 3) {
        this.socketFailures = 0;
        const wait = this.socketGate.fail('chat');
        this.logger.warn(`No se pudo escuchar el chat de los lives; se pausa ${Math.ceil(wait / 1000)}s`);
      }
      return null;
    }
    const timer = setTimeout(finish, this.config.chatSampleSeconds * 1000);
    await done;
    clearTimeout(timer);
    await close().catch(() => undefined);
    return sample;
  }
}
