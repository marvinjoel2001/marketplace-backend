import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
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
export class TikTokLivesWorker implements OnModuleDestroy {
  private readonly logger = new Logger(TikTokLivesWorker.name);
  private readonly retry = new RetryGate();
  private readonly checking = new Set<string>();
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

  @Cron('0 */3 * * * *', { timeZone: 'America/La_Paz' })
  async discover(): Promise<void> {
    if (!this.config.enabled || this.stopping || !this.retry.ready('discovery'))
      return;
    await this.cache.withLease('discovery', async (owned) => {
      try {
        const candidates = await this.discovery.discover();
        this.retry.success('discovery');
        const selling = candidates.filter((live) => {
          const classification = this.classifier.classify(live);
          return classification.isSelling && classification.geoEvidence;
        });
        await this.each(selling, owned, (live) =>
          this.verify(live.username, live, undefined, owned),
        );
        this.logger.log(
          `Exploración TikTok: ${candidates.length} candidatos, ${selling.length} con indicios de venta y región`,
        );
      } catch {
        const wait = this.retry.fail('discovery');
        this.logger.warn(
          `Exploración TikTok pausada (bloqueo o fallo); reintento después de ${Math.ceil(wait / 1000)}s`,
        );
      }
    });
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

  @Interval(30000)
  async refreshActive(): Promise<void> {
    if (!this.config.enabled || this.stopping) return;
    await this.cache.withLease('refresh', async (owned) => {
      const active = await this.prisma.tikTokLive.findMany({
        where: { status: 'ACTIVE' },
        include: { store: true },
      });
      await this.each(active, owned, (row) =>
        this.verify(
          row.username,
          {
            username: row.username,
            roomId: row.roomId,
            title: row.title,
            viewerCount: row.viewerCount,
            avatarUrl: row.avatarUrl,
            coverImageUrl: row.coverImageUrl,
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
      !this.retry.ready(username)
    )
      return;
    this.checking.add(username);
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
            const result = await this.connector.probe(username);
            if (!stillOwned() || this.stopping) return;
            this.retry.success(username);
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
            };
            const saved = await this.lives.saveVerified(live, store);
            if (saved && stillOwned() && !this.stopping)
              await this.connector.watch(live);
            else await this.connector.unwatch(username);
          } catch {
            const wait = this.retry.fail(username);
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
      Array.from({ length: Math.min(3, items.length) }, async () => {
        while (index < items.length && !this.stopping && owned())
          await task(items[index++]);
      }),
    );
  }
  onModuleDestroy(): void {
    this.stopping = true;
  }
}
