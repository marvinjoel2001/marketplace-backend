import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceClassifier } from './ecommerce-classifier.service';
import { TikTokDiscoveryService } from './tiktok-discovery.service';
import { TikTokConnectorService } from './tiktok-connector.service';
import { TikTokLiveCache } from './tiktok-live-cache.service';
import { TikTokLivesConfig } from './tiktok-lives.config';
import { TikTokLivesService } from './tiktok-lives.service';
import {
  LiveCandidate,
  normalizeUsername,
  RetryGate,
} from './tiktok-lives.types';

@Injectable()
export class TikTokLivesWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TikTokLivesWorker.name);
  private readonly retry = new RetryGate();
  private readonly accountRetry = new RetryGate(15000, 60000);
  private readonly lastCheck = new Map<string, number>();
  private readonly checking = new Set<string>();
  private seedCursor = 0;
  private stopping = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly discovery: TikTokDiscoveryService,
    private readonly connector: TikTokConnectorService,
    private readonly classifier: EcommerceClassifier,
    private readonly lives: TikTokLivesService,
    private readonly cache: TikTokLiveCache,
    private readonly config: TikTokLivesConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.enabled || this.config.runOnStartup === false) return;
    // Start useful work immediately; HTTP startup does not wait for Chromium.
    void Promise.allSettled([
      this.refreshActive(), this.registeredStores(), this.discover(),
    ]);
  }

  @Cron('0 */3 * * * *', { timeZone: 'America/La_Paz' })
  async discover(): Promise<void> {
    if (!this.config.enabled || this.stopping || !this.retry.ready('discovery'))
      return;
    await this.cache.withLease('discovery', async (owned) => {
      try {
        const candidates = await this.discovery.discover(await this.seeds());
        this.retry.success('discovery');
        const selling = candidates.filter(
          // Regional data often appears only in full room info. Do not reject
          // a seller before that enrichment; saveVerified applies the final filter.
          (live) => this.classifier.classify(live).isSelling,
        );
        await this.each(selling, owned, (live) =>
          this.verify(live.username, live, undefined, owned),
        );
        this.logger.log(
          `Exploración TikTok: ${candidates.length} candidatos, ${selling.length} vendedores revisados${this.config.requireRegion ? ' con filtro regional' : ''}`,
        );
      } catch {
        const wait = this.retry.fail('discovery');
        this.logger.warn(
          `Exploración TikTok pausada (bloqueo o fallo); reintento después de ${Math.ceil(wait / 1000)}s`,
        );
      }
    });
  }

  /** Rotating sample of live sellers whose rooms seed the next discovery cycle. */
  private async seeds(): Promise<string[]> {
    const count = this.config.snowballPerCycle;
    if (!count) return [];
    const live = await this.prisma.tikTokLive.findMany({
      where: { status: 'ACTIVE', isSelling: true },
      orderBy: { username: 'asc' },
      select: { username: true },
    });
    if (!live.length) return [];
    const start = this.seedCursor % live.length;
    this.seedCursor = start + count;
    return Array.from(
      { length: Math.min(count, live.length) },
      (_, i) => live[(start + i) % live.length].username,
    );
  }

  @Cron('0 */3 * * * *', { timeZone: 'America/La_Paz' })
  async registeredStores(): Promise<void> {
    if (!this.config.enabled || this.stopping) return;
    await this.cache.withLease('stores', async (owned) => {
      const accounts = await this.prisma.tikTokAccount.findMany({
        where: { store: { status: 'ACTIVE' } },
        include: { store: true },
      });
      await this.each(accounts, owned, (account) => {
        const username = normalizeUsername(account.username);
        return username
          ? this.verify(username, undefined, account.store, owned)
          : Promise.resolve();
      });
    });
  }

  /**
   * Sellers found before go live again almost daily, and TikTok's public feed only shows a few per
   * visit (LIVE search needs a login). Re-probe ended, previously listed sellers in rotation,
   * least recently checked first; markEnded bumps updatedAt so the rotation advances.
   */
  @Cron('30 1-59/3 * * * *', { timeZone: 'America/La_Paz' })
  async knownSellers(): Promise<void> {
    if (!this.config.enabled || this.stopping || this.config.recheckPerCycle === 0)
      return;
    await this.cache.withLease('known', async (owned) => {
      const known = await this.prisma.tikTokLive.findMany({
        where: { status: 'ENDED', storeId: null },
        orderBy: { updatedAt: 'asc' },
        take: this.config.recheckPerCycle,
        select: { username: true },
      });
      const startBefore = Date.now() + 150000;
      await this.each(known, () => owned() && Date.now() < startBefore, (row) =>
        this.verify(row.username, undefined, undefined, owned),
      );
    });
  }

  @Interval(30000)
  async refreshActive(): Promise<void> {
    if (!this.config.enabled || this.stopping) return;
    await this.cache.withLease('refresh', async (owned) => {
      const active = await this.prisma.tikTokLive.findMany({
        where: { status: 'ACTIVE' },
        include: { store: true },
        orderBy: { verifiedAt: 'asc' },
      });
      // Failed/slow accounts must not monopolize the front of every batch.
      active.sort((a, b) => (this.lastCheck.get(a.username) ?? 0) - (this.lastCheck.get(b.username) ?? 0));
      const startBefore = Date.now() + 20000;
      await this.each(active, () => owned() && Date.now() < startBefore, (row) =>
        this.verify(
          row.username,
          {
            username: row.username,
            roomId: row.roomId,
            title: row.title,
            viewerCount: row.viewerCount,
            avatarUrl: row.avatarUrl,
            coverImageUrl: row.coverImageUrl,
            streamHlsUrl: row.streamHlsUrl ?? undefined,
            streamFlvUrl: row.streamFlvUrl ?? undefined,
            tags: this.tags(row.tags),
            countryCode:
              row.geoEvidence === 'tiktok_country'
                ? row.countryCode
                : undefined,
          },
          row.store,
          owned,
        ),
      );
    });
  }

  private async verify(
    username: string,
    candidate?: LiveCandidate,
    store?: { id: string; category: string; address: string; status?: string },
    owned = () => true,
  ): Promise<void> {
    if (
      this.stopping ||
      !owned() ||
      this.checking.has(username) ||
      !this.accountRetry.ready(username)
    )
      return;
    this.checking.add(username);
    this.lastCheck.set(username, Date.now());
    if (this.lastCheck.size > 2000) this.lastCheck.delete(this.lastCheck.keys().next().value);
    try {
      await this.cache.withLease(
        `account:${username}`,
        async (accountOwned) => {
          const stillOwned = () => owned() && accountOwned();
          try {
            if (!store) {
              const account = await this.prisma.tikTokAccount.findUnique({
                where: { username },
                include: { store: true },
              });
              store = account?.store;
            }
            if (store && store.status !== 'ACTIVE') {
              await this.lives.markEnded(username);
              await this.connector.unwatch(username);
              return;
            }
            const result = await this.connector.probe(username, candidate?.roomId);
            if (!stillOwned() || this.stopping) return;
            this.accountRetry.success(username);
            if (!result.live) {
              await this.lives.markEnded(username);
              if (store)
                await this.prisma.store.updateMany({
                  where: { id: store.id },
                  data: { isLiveNow: false },
                });
              await this.connector.unwatch(username);
              return;
            }
            const live: LiveCandidate = {
              ...candidate,
              ...result.live,
              nickname: result.live.nickname ||
                (candidate?.roomId === result.live.roomId ? candidate.nickname : undefined),
              bio: result.live.bio ||
                (candidate?.roomId === result.live.roomId ? candidate.bio : undefined),
              title:
                result.live.title ||
                (candidate?.roomId === result.live.roomId
                  ? candidate.title
                  : ''),
              tags: [
                ...new Set([
                  ...(result.live.tags ?? []),
                  ...(candidate?.roomId === result.live.roomId
                    ? candidate.tags
                    : []),
                  ...(store ? [store.category, 'tienda'] : []),
                ]),
              ],
              countryCode:
                result.live.countryCode ??
                (candidate?.roomId === result.live.roomId
                  ? candidate.countryCode
                  : undefined),
              streamHlsUrl:
                result.live.streamHlsUrl ??
                (candidate?.roomId === result.live.roomId
                  ? candidate.streamHlsUrl
                  : undefined),
              streamFlvUrl:
                result.live.streamFlvUrl ??
                (candidate?.roomId === result.live.roomId
                  ? candidate.streamFlvUrl
                  : undefined),
            };
            const saved = await this.lives.saveVerified(live, store);
            if (saved && stillOwned() && !this.stopping)
              // Signature-provider latency must not hold up HTTP verification
              // of every other room in the batch.
              void this.connector.watch(live).catch(() =>
                this.logger.warn('Socket TikTok no disponible; se mantiene verificación HTTP'),
              );
            else await this.connector.unwatch(username);
          } catch {
            const wait = this.accountRetry.fail(username);
            this.logger.warn(
              `Verificación TikTok temporalmente indisponible; backoff ${Math.ceil(wait / 1000)}s. La vigencia anterior no se renueva.`,
            );
          }
        },
      );
    } finally {
      this.checking.delete(username);
    }
  }
  private tags(raw: string): string[] {
    try {
      const tags = JSON.parse(raw);
      return Array.isArray(tags)
        ? tags.filter((t) => typeof t === 'string')
        : [];
    } catch {
      return [];
    }
  }

  private async each<T>(
    items: T[],
    owned: () => boolean,
    task: (item: T) => Promise<void>,
  ): Promise<void> {
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(this.config.verifyConcurrency, items.length) }, async () => {
        while (index < items.length && !this.stopping && owned())
          await task(items[index++]);
      }),
    );
  }
  onModuleDestroy(): void {
    this.stopping = true;
  }
}
