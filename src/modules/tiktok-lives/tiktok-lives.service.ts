import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TikTokLive } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EcommerceClassifier } from './ecommerce-classifier.service';
import {
  CITIES,
  detectCity,
  extractPrice,
  extractWhatsApp,
  salesScore,
} from './live-insights';
import { TikTokLiveCache } from './tiktok-live-cache.service';
import { TikTokLivesConfig } from './tiktok-lives.config';
import {
  ActiveLive,
  CATEGORIES,
  imageUrl,
  LiveCandidate,
  LIVE_TTL_SECONDS,
  LIVE_RETENTION_SECONDS,
  normalizeText,
  normalizeUsername,
  viewerCount,
} from './tiktok-lives.types';

@Injectable()
export class TikTokLivesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classifier: EcommerceClassifier,
    private readonly cache: TikTokLiveCache,
    private readonly config: TikTokLivesConfig,
  ) {}

  async active(query: {
    page?: string;
    limit?: string;
    category?: string;
    city?: string;
  }) {
    const page = this.pageNumber(query.page, 1, 10000);
    const limit = this.pageNumber(query.limit, 20, 100);
    if (query.category !== undefined && typeof query.category !== 'string')
      throw new BadRequestException('Categoría inválida');
    const category =
      query.category === undefined
        ? undefined
        : CATEGORIES.find(
            (c) => normalizeText(c) === normalizeText(query.category),
          );
    if (query.category !== undefined && !category)
      throw new BadRequestException(
        `Categoría inválida: ${CATEGORIES.join(', ')}`,
      );
    if (query.city !== undefined && typeof query.city !== 'string')
      throw new BadRequestException('Ciudad inválida');
    const city =
      query.city === undefined
        ? undefined
        : CITIES.find((c) => normalizeText(c) === normalizeText(query.city));
    if (query.city !== undefined && !city)
      throw new BadRequestException(`Ciudad inválida: ${CITIES.join(', ')}`);
    let lives = await this.cache.read();
    if (lives === null) {
      const version = await this.cache.version();
      const rows = await this.prisma.tikTokLive.findMany({
        where: {
          status: 'ACTIVE',
          isSelling: true,
          countryCode: this.config.country,
          verifiedAt: { gt: new Date(Date.now() - LIVE_RETENTION_SECONDS * 1000) },
        },
        orderBy: [{ viewerCount: 'desc' }, { username: 'asc' }],
      });
      lives = rows.map((row) => this.serialize(row));
      await this.cache.write(lives, version);
    }
    // Grace never changes verified_at and never includes an explicitly ended room.
    const now = Date.now();
    const inCategory = lives.filter(
      (live) =>
        live.is_selling &&
        live.country_code === this.config.country &&
        (!this.config.requireRegion || live.geo_evidence !== 'unverified') &&
        Number.isFinite(Date.parse(live.verified_at)) &&
          Date.parse(live.verified_at) > now - LIVE_RETENTION_SECONDS * 1000 &&
        Date.parse(live.verified_at) <= now &&
        (!category || live.category === category),
    );
    // Counted before the city filter, so the city chips keep showing every option.
    const cities = CITIES.map((name) => ({
      name,
      count: inCategory.filter((live) => live.city === name).length,
    })).filter((c) => c.count > 0);
    // Clear sales first (title signal, price, WhatsApp), then audience.
    const filtered = inCategory
      .filter((live) => !city || live.city === city)
      .map((live) => ({
        ...live,
        verification_status: (Date.parse(live.verified_at) > now - LIVE_TTL_SECONDS * 1000
          ? 'fresh' : 'refreshing') as 'fresh' | 'refreshing',
      }))
      .sort(
        (a, b) =>
          Number(b.verification_status === 'fresh') - Number(a.verification_status === 'fresh') ||
          b.sales_score - a.sales_score ||
          b.viewer_count - a.viewer_count ||
          a.username.localeCompare(b.username),
      );
    return {
      data: filtered.slice((page - 1) * limit, page * limit),
      pagination: {
        page,
        limit,
        total: filtered.length,
        total_pages: Math.ceil(filtered.length / limit),
      },
      meta: {
        cache: this.cache.backend,
        worker_enabled: this.config.enabled,
        freshness_seconds: LIVE_TTL_SECONDS,
        retention_seconds: LIVE_RETENTION_SECONDS,
        active_count: filtered.filter((live) => live.verification_status === 'fresh').length,
        refreshing_count: filtered.filter((live) => live.verification_status === 'refreshing').length,
        status: !this.config.enabled ? 'disabled'
          : filtered.some((live) => live.verification_status === 'fresh') ? 'live'
          : filtered.length ? 'refreshing' : 'searching',
        server_time: new Date(now).toISOString(),
        country_code: this.config.country,
        cities,
      },
    };
  }

  async register(storeId: string, rawUsername: unknown) {
    const username = normalizeUsername(rawUsername);
    if (!username)
      throw new BadRequestException(
        'tiktok_username inválido (1–24 letras, números, punto o guion bajo)',
      );
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
    });
    if (!store || store.status !== 'ACTIVE')
      throw new NotFoundException('Tienda activa no encontrada');
    const duplicate = await this.prisma.tikTokAccount.findUnique({
      where: { username },
    });
    if (duplicate && duplicate.storeId !== storeId)
      throw new BadRequestException(
        'La cuenta TikTok ya está vinculada a otra tienda',
      );
    try {
      await this.prisma.$transaction([
        this.prisma.tikTokAccount.upsert({
          where: { storeId },
          create: { storeId, username, countryCode: this.config.country },
          update: { username, countryCode: this.config.country },
        }),
        this.prisma.store.update({
          where: { id: storeId },
          data: {
            tiktokUsername: username,
            tiktokLiveUrl: `https://www.tiktok.com/@${username}/live`,
            isLiveNow: false,
          },
        }),
        this.prisma.tikTokLive.updateMany({
          where: { storeId },
          data: { status: 'ENDED' },
        }),
      ]);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002')
        throw new BadRequestException(
          'La cuenta TikTok ya está vinculada a otra tienda',
        );
      throw error;
    }
    await this.cache.invalidate();
    return {
      store_id: storeId,
      tiktok_username: username,
      country_code: this.config.country,
      verification: 'pending',
      ownership_verified: false,
    };
  }

  async saveVerified(
    live: LiveCandidate,
    store?: { id: string; category: string; address: string },
  ) {
    const username = normalizeUsername(live.username);
    if (!username || !/^\d{5,30}$/.test(live.roomId ?? '')) return;
    let localStore = false;
    if (store) {
      const current = await this.prisma.store.findUnique({
        where: { id: store.id },
      });
      if (
        !current ||
        current.status !== 'ACTIVE' ||
        normalizeUsername(current.tiktokUsername) !== username
      )
        return;
      const account = await this.prisma.tikTokAccount.findUnique({
        where: { username },
      });
      if (!account || account.storeId !== store.id) return;
      localStore = account.countryCode === this.config.country;
    }
    // The administrative local-store registry is evidence, not proof of account ownership.
    const classification = this.classifier.classify(live, !!localStore);
    if (!classification.listable) {
      await this.markEnded(username, live.roomId);
      return;
    }
    const data = {
      roomId: live.roomId,
      title: live.title.slice(0, 500),
      viewerCount: viewerCount(live.viewerCount),
      avatarUrl: imageUrl(live.avatarUrl) ?? null,
      coverImageUrl: imageUrl(live.coverImageUrl) ?? null,
      streamHlsUrl: imageUrl(live.streamHlsUrl) ?? null,
      streamFlvUrl: imageUrl(live.streamFlvUrl) ?? null,
      tags: JSON.stringify(
        live.tags.slice(0, 30).map((tag) => tag.slice(0, 80)),
      ),
      category: classification.category,
      isSelling: true,
      countryCode: this.config.country,
      geoEvidence: classification.geoEvidence ?? 'unverified',
      source: store ? 'registered_store' : 'discovery',
      storeId: store?.id ?? null,
      status: 'ACTIVE',
      verifiedAt: new Date(),
    };
    await this.prisma.tikTokLive.upsert({
      where: { username },
      create: { username, ...data },
      update: data,
    });
    if (store)
      await this.prisma.store.update({
        where: { id: store.id },
        data: { isLiveNow: true },
      });
    await this.cache.invalidate();
    return data;
  }

  async markEnded(username: string, roomId?: string): Promise<void> {
    const existing = await this.prisma.tikTokLive.findUnique({
      where: { username },
    });
    if (!existing || (roomId && existing.roomId !== roomId)) return;
    const updated = await this.prisma.tikTokLive.updateMany({
      where: { username, roomId: roomId ?? existing.roomId },
      data: { status: 'ENDED' },
    });
    if (updated.count && existing.storeId)
      await this.prisma.store.updateMany({
        where: { id: existing.storeId, tiktokUsername: username },
        data: { isLiveNow: false },
      });
    await this.cache.invalidate();
  }

  async updateViewers(
    username: string,
    roomId: string,
    count: unknown,
  ): Promise<void> {
    // Viewer counts are cosmetic: don't invalidate the whole snapshot on every socket event
    // (it would defeat the snapshot cache). The next refresh picks the new value up.
    await this.prisma.tikTokLive.updateMany({
      where: { username, roomId, status: 'ACTIVE' },
      data: { viewerCount: viewerCount(count) },
    });
  }

  private pageNumber(
    raw: string | undefined,
    fallback: number,
    max: number,
  ): number {
    if (raw === undefined) return fallback;
    if (
      typeof raw !== 'string' ||
      !/^\d+$/.test(raw) ||
      Number(raw) < 1 ||
      Number(raw) > max
    )
      throw new BadRequestException(`Paginación inválida (1–${max})`);
    return Number(raw);
  }
  private serialize(row: TikTokLive): ActiveLive {
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(row.tags);
      if (Array.isArray(parsed))
        tags = parsed.filter((t) => typeof t === 'string');
    } catch {
      /* legacy data */
    }
    const price = extractPrice(row.title);
    const whatsapp = extractWhatsApp(row.title);
    return {
      username: row.username,
      room_id: row.roomId,
      live_id: row.roomId,
      title: row.title,
      viewer_count: row.viewerCount,
      avatar_url: row.avatarUrl,
      cover_image_url: row.coverImageUrl,
      stream_hls_url: row.streamHlsUrl,
      stream_flv_url: row.streamFlvUrl,
      tags,
      category: row.category,
      is_selling: row.isSelling,
      country_code: row.countryCode,
      geo_evidence: row.geoEvidence,
      source: row.source,
      store_id: row.storeId,
      verified_at: row.verifiedAt.toISOString(),
      live_url: `https://www.tiktok.com/@${row.username}/live`,
      city: detectCity([row.title, ...tags, row.username, row.geoEvidence]),
      price_text: price,
      whatsapp_url: whatsapp
        ? `https://wa.me/${whatsapp}?text=${encodeURIComponent('Hola! Te vi en tu LIVE de TikTok (Vitrina Market)')}`
        : null,
      sales_score: salesScore({
        title: row.title,
        tags,
        category: row.category,
        price,
        whatsapp,
      }),
    };
  }
}
