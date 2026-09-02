import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StoresService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: { isLive?: boolean }) {
    const whereClause: any = {};
    if (params.isLive) {
      whereClause.isLiveNow = true;
    }

    return this.prisma.store.findMany({
      where: whereClause,
      include: {
        liveStreams: {
          where: { status: 'LIVE' },
          take: 1,
        },
        _count: {
          select: { offers: true },
        },
      },
      orderBy: { salesCount: 'desc' },
    });
  }

  async findBySlugOrId(idOrSlug: string) {
    let store = await this.prisma.store.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
      },
      include: {
        offers: {
          where: { isActive: true },
          include: {
            product: {
              include: { category: true },
            },
          },
        },
        liveStreams: {
          where: { status: 'LIVE' },
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!store) {
      // Fallback a tienda de demo techplus-bolivia
      store = await this.prisma.store.findFirst({
        where: { slug: 'techplus-bolivia' },
        include: {
          offers: {
            where: { isActive: true },
            include: {
              product: {
                include: { category: true },
              },
            },
          },
          liveStreams: {
            where: { status: 'LIVE' },
            orderBy: { startedAt: 'desc' },
            take: 1,
          },
        },
      });
    }

    if (!store) throw new NotFoundException('Tienda no encontrada');
    return store;
  }

  async create(data: {
    name: string;
    category: string;
    address: string;
    phone?: string;
    description?: string;
    logo?: string;
    banner?: string;
    tiktokUsername?: string;
    tiktokLiveUrl?: string;
    latitude?: number | string;
    longitude?: number | string;
  }) {
    const {
      name,
      category,
      address,
      phone,
      description,
      logo,
      banner,
      tiktokUsername,
      tiktokLiveUrl,
      latitude = -17.7833,
      longitude = -63.1821,
    } = data;

    if (!name || !category || !address) {
      throw new BadRequestException('Nombre, categoría y dirección son obligatorios');
    }

    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-4)}`;

    return this.prisma.store.create({
      data: {
        name,
        slug,
        category,
        address,
        phone,
        description: description || `Tienda oficial de ${name} en CompraYa`,
        logo: logo || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
        banner: banner || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&auto=format&fit=crop&q=80',
        tiktokUsername,
        tiktokLiveUrl,
        latitude: typeof latitude === 'string' ? parseFloat(latitude) : latitude,
        longitude: typeof longitude === 'string' ? parseFloat(longitude) : longitude,
        isOfficial: true,
        rating: 5.0,
      },
    });
  }
}
