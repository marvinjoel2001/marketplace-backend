import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TikTokLiveCache } from './tiktok-live-cache.service';
import { TikTokLivesConfig } from './tiktok-lives.config';
import { LIVE_RETENTION_SECONDS, normalizeUsername } from './tiktok-lives.types';

/** Enough for a store's main, backup and branch accounts without turning it into a directory. */
export const MAX_ACCOUNTS_PER_STORE = 5;

const TAKEN = 'Esa cuenta de TikTok ya está vinculada a otra tienda';
const INVALID =
  'No reconocemos ese usuario. Copia el que empieza con @ en tu perfil de TikTok, o pega el enlace de tu perfil.';

/** Short share links ("Copiar enlace" in the TikTok app) redirect to the profile URL. */
const SHORT_LINK = /^https?:\/\/(?:vm|vt|www)\.tiktok\.com\/(?:t\/)?[A-Za-z0-9]+\/?(?:\?.*)?$/;

export interface StoreTikTokAccount {
  username: string;
  /** TikTok shows this account broadcasting now (seen within the retention window). */
  live: boolean;
  viewerCount: number;
  profileUrl: string;
  liveUrl: string;
  addedAt: string;
}

/** Reads "@user", "user", or a profile link (https://www.tiktok.com/@user/live?...). */
export function usernameFromText(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  const fromUrl = text.match(/tiktok\.com\/@([A-Za-z0-9_.]+)/i)?.[1];
  return normalizeUsername(fromUrl ?? text.replace(/^@+/, ''));
}

/**
 * The TikTok accounts a store sells from. Every account is reviewed for lives, and a live on any
 * of them shows the store's products. The oldest one is the store's main account (the link used
 * when none is live), mirrored in Store.tiktokUsername for older screens.
 */
@Injectable()
export class StoreTikTokAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TikTokLiveCache,
    private readonly config: TikTokLivesConfig,
  ) {}

  async list(storeId: string): Promise<StoreTikTokAccount[]> {
    const accounts = await this.prisma.tikTokAccount.findMany({
      where: { storeId },
      orderBy: { createdAt: 'asc' },
    });
    if (!accounts.length) return [];
    const fresh = new Date(Date.now() - LIVE_RETENTION_SECONDS * 1000);
    const lives = await this.prisma.tikTokLive.findMany({
      where: {
        username: { in: accounts.map((a) => a.username) },
        storeId,
        status: 'ACTIVE',
        verifiedAt: { gte: fresh },
      },
    });
    const live = new Map(lives.map((row) => [row.username, row]));
    return accounts.map((account) => ({
      username: account.username,
      live: live.has(account.username),
      viewerCount: live.get(account.username)?.viewerCount ?? 0,
      profileUrl: `https://www.tiktok.com/@${account.username}`,
      liveUrl: `https://www.tiktok.com/@${account.username}/live`,
      addedAt: account.createdAt.toISOString(),
    }));
  }

  /** Accepts "@user", "user", a profile link or a short share link. */
  async resolve(input: unknown): Promise<string> {
    const direct = usernameFromText(input);
    if (direct) return direct;
    const text = typeof input === 'string' ? input.trim() : '';
    if (SHORT_LINK.test(text)) {
      const resolved = await this.followShortLink(text);
      if (resolved) return resolved;
    }
    throw new BadRequestException(INVALID);
  }

  async add(storeId: string, input: unknown): Promise<StoreTikTokAccount[]> {
    const username = await this.resolve(input);
    await this.activeStore(storeId);
    const existing = await this.prisma.tikTokAccount.findUnique({ where: { username } });
    if (existing?.storeId === storeId) return this.list(storeId);
    if (existing) throw new BadRequestException(TAKEN);
    const count = await this.prisma.tikTokAccount.count({ where: { storeId } });
    if (count >= MAX_ACCOUNTS_PER_STORE)
      throw new BadRequestException(`Puedes vincular hasta ${MAX_ACCOUNTS_PER_STORE} cuentas de TikTok. Quita una para añadir otra.`);
    await this.write(() =>
      this.prisma.tikTokAccount.create({ data: { storeId, username, countryCode: this.config.country } }),
    );
    await this.afterChange(storeId);
    return this.list(storeId);
  }

  /** Fixes a mistyped or changed username, keeping the account's place in the list. */
  async rename(storeId: string, current: string, input: unknown): Promise<StoreTikTokAccount[]> {
    const from = normalizeUsername(current);
    const account = from ? await this.prisma.tikTokAccount.findUnique({ where: { username: from } }) : null;
    if (!account || account.storeId !== storeId) throw new NotFoundException('Esa cuenta no está vinculada a tu tienda');
    const username = await this.resolve(input);
    if (username === from) return this.list(storeId);
    const taken = await this.prisma.tikTokAccount.findUnique({ where: { username } });
    if (taken) throw new BadRequestException(taken.storeId === storeId ? 'Esa cuenta ya está en tu lista' : TAKEN);
    await this.write(() =>
      this.prisma.$transaction([
        this.prisma.tikTokAccount.delete({ where: { username: from! } }),
        this.prisma.tikTokAccount.create({
          data: { storeId, username, countryCode: account.countryCode, createdAt: account.createdAt },
        }),
        this.prisma.tikTokLive.updateMany({ where: { username: from!, storeId }, data: { status: 'ENDED' } }),
      ]),
    );
    await this.afterChange(storeId);
    return this.list(storeId);
  }

  async remove(storeId: string, current: string): Promise<StoreTikTokAccount[]> {
    const username = normalizeUsername(current);
    const account = username ? await this.prisma.tikTokAccount.findUnique({ where: { username } }) : null;
    if (!account || account.storeId !== storeId) throw new NotFoundException('Esa cuenta no está vinculada a tu tienda');
    await this.prisma.$transaction([
      this.prisma.tikTokAccount.delete({ where: { username: username! } }),
      this.prisma.tikTokLive.updateMany({ where: { username: username!, storeId }, data: { status: 'ENDED' } }),
    ]);
    await this.afterChange(storeId);
    return this.list(storeId);
  }

  /** Keeps Store.tiktokUsername (the main account) and the live flag in line with the accounts. */
  private async afterChange(storeId: string): Promise<void> {
    const [main, live] = await Promise.all([
      this.prisma.tikTokAccount.findFirst({ where: { storeId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.tikTokLive.count({ where: { storeId, status: 'ACTIVE' } }),
    ]);
    await this.prisma.store.update({
      where: { id: storeId },
      data: {
        tiktokUsername: main?.username ?? null,
        tiktokLiveUrl: main ? `https://www.tiktok.com/@${main.username}/live` : null,
        isLiveNow: live > 0,
      },
    });
    await this.cache.invalidate();
  }

  private async activeStore(storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store || store.status !== 'ACTIVE') throw new NotFoundException('Tienda activa no encontrada');
    return store;
  }

  private async write<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new BadRequestException(TAKEN);
      throw error;
    }
  }

  private async followShortLink(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000) });
      return usernameFromText(res.headers.get('location') ?? '');
    } catch {
      return null;
    }
  }
}
