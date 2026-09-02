import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
          include: {
            offers: {
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
        streamerAvatar: streamerAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        viewerCount: Math.floor(Math.random() * 800) + 400,
        likeCount: Math.floor(Math.random() * 3000) + 1000,
        status: 'LIVE',
        tiktokUrl,
        featuredProductIds: Array.isArray(featuredProductIds) ? featuredProductIds.join(',') : featuredProductIds || '',
      },
      include: {
        store: true,
      },
    });
  }
}
