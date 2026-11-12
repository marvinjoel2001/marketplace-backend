import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PUBLIC_STORE_SELECT } from '../stores/public-store';

@Injectable()
export class LiveStreamsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(storeId?: string) {
    const whereClause: any = { status: 'LIVE' };
    if (storeId) {
      whereClause.storeId = storeId;
    }

    return this.prisma.liveStream.findMany({
      where: whereClause,
      include: {
        store: {
          select: {
            ...PUBLIC_STORE_SELECT,
            offers: {
              where: { isActive: true },
              take: 5,
              include: { product: true },
            },
          },
        },
      },
      orderBy: { viewerCount: 'desc' },
    });
  }

  async create(data: {
    storeId: string;
    title: string;
    streamerName?: string;
    streamerAvatar?: string;
    featuredProductIds?: string | string[];
    tiktokUrl?: string;
  }) {
    const { storeId, title, streamerName, streamerAvatar, featuredProductIds, tiktokUrl } = data;

    if (!storeId || !title) {
      throw new BadRequestException('storeId y title son obligatorios');
    }

    // Actualizar estado de la tienda a en vivo
    await this.prisma.store.update({
      where: { id: storeId },
      data: { isLiveNow: true },
    });

    return this.prisma.liveStream.create({
      data: {
        storeId,
        title,
        streamerName: streamerName || 'Presentador Oficial',
        streamerAvatar: streamerAvatar || '',
        // Real audience numbers come from TikTok (tiktok-lives); none are made up here.
        viewerCount: 0,
        likeCount: 0,
        status: 'LIVE',
        tiktokUrl,
        featuredProductIds: Array.isArray(featuredProductIds) ? featuredProductIds.join(',') : featuredProductIds || '',
      },
      include: { store: { select: PUBLIC_STORE_SELECT } },
    });
  }

  async startLive(id: string) {
    const stream = await this.prisma.liveStream.update({
      where: { id },
      data: { status: 'LIVE' },
      include: { store: { select: PUBLIC_STORE_SELECT } },
    });

    if (stream.storeId) {
      await this.prisma.store.update({
        where: { id: stream.storeId },
        data: { isLiveNow: true },
      });
    }

    return stream;
  }

  async endLive(id: string) {
    const stream = await this.prisma.liveStream.update({
      where: { id },
      data: { status: 'ENDED' },
      include: { store: { select: PUBLIC_STORE_SELECT } },
    });

    if (stream.storeId) {
      await this.prisma.store.update({
        where: { id: stream.storeId },
        data: { isLiveNow: false },
      });
    }

    return stream;
  }

  async featureProduct(id: string, productId: string) {
    return this.prisma.liveStream.update({
      where: { id },
      data: { featuredProductIds: productId },
      include: { store: { select: PUBLIC_STORE_SELECT } },
    });
  }
}
