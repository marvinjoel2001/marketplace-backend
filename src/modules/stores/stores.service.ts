import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StoresService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: { isLive?: boolean }) {
    const whereClause: any = {
      status: 'ACTIVE',
    };
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

  // ====================================================
  // OFERTAS Y PROMOCIONES DE TIENDA (STORE OFFERS & FLASH SALES)
  // ====================================================
  async getOffers(storeId: string) {
    const store = await this.prisma.store.findFirst({
      where: { OR: [{ id: storeId }, { slug: storeId }] },
    });
    if (!store) throw new NotFoundException('Tienda no encontrada');

    return this.prisma.productOffer.findMany({
      where: { storeId: store.id },
      include: {
        product: {
          include: { category: true },
        },
      },
      orderBy: [{ isFlashSale: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async createOrUpdateFlashOffer(
    storeId: string,
    data: {
      productId?: string;
      offerId?: string;
      salePrice: number;
      discountPercent?: number;
      durationHours?: number;
      flashSaleEnd?: string;
      promoBadge?: string;
      promoStock?: number;
    },
  ) {
    const store = await this.prisma.store.findFirst({
      where: { OR: [{ id: storeId }, { slug: storeId }] },
    });
    if (!store) throw new NotFoundException('Tienda no encontrada');

    let offer: any = null;
    if (data.offerId) {
      offer = await this.prisma.productOffer.findUnique({
        where: { id: data.offerId },
        include: { product: true },
      });
    } else if (data.productId) {
      offer = await this.prisma.productOffer.findUnique({
        where: {
          productId_storeId: {
            productId: data.productId,
            storeId: store.id,
          },
        },
        include: { product: true },
      });
    }

    if (!offer) {
      throw new NotFoundException('Oferta o producto no encontrado para esta tienda');
    }

    const originalPrice = offer.price || offer.product?.basePrice || 100;
    const salePrice = Number(data.salePrice);
    const discountPercent =
      data.discountPercent !== undefined
        ? Number(data.discountPercent)
        : Math.round(((originalPrice - salePrice) / originalPrice) * 100);

    const duration = data.durationHours ? Number(data.durationHours) : 24;
    const endDate = data.flashSaleEnd
      ? new Date(data.flashSaleEnd)
      : new Date(Date.now() + duration * 60 * 60 * 1000);

    const updatedOffer = await this.prisma.productOffer.update({
      where: { id: offer.id },
      data: {
        isFlashSale: true,
        salePrice,
        discountPercent: Math.max(0, discountPercent),
        flashSaleEnd: endDate,
        promoBadge: data.promoBadge || 'OFERTA_FLASH',
        promoStock: data.promoStock ? Number(data.promoStock) : offer.stock,
      },
      include: { product: true },
    });

    // Sincronizar con el producto para visibilidad global en filtros flash
    await this.prisma.product.update({
      where: { id: offer.productId },
      data: {
        isFlashSale: true,
        flashSaleEnd: endDate,
        discountPercent: Math.max(0, discountPercent),
      },
    });

    return updatedOffer;
  }

  async toggleOfferPromo(storeId: string, offerId: string) {
    const offer = await this.prisma.productOffer.findUnique({
      where: { id: offerId },
    });
    if (!offer) throw new NotFoundException('Oferta no encontrada');

    const newFlash = !offer.isFlashSale;
    const updated = await this.prisma.productOffer.update({
      where: { id: offerId },
      data: {
        isFlashSale: newFlash,
        ...(!newFlash ? { salePrice: null, flashSaleEnd: null } : {}),
      },
    });

    // Actualizar producto
    await this.prisma.product.update({
      where: { id: offer.productId },
      data: {
        isFlashSale: newFlash,
        ...(!newFlash ? { flashSaleEnd: null } : {}),
      },
    });

    return updated;
  }

  // ====================================================
  // CUPONES DE DESCUENTO DE LA TIENDA (STORE COUPONS)
  // ====================================================
  async getCoupons(storeId: string) {
    const store = await this.prisma.store.findFirst({
      where: { OR: [{ id: storeId }, { slug: storeId }] },
    });
    if (!store) throw new NotFoundException('Tienda no encontrada');

    return this.prisma.coupon.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createCoupon(
    storeId: string,
    data: {
      code: string;
      discountType?: string;
      discountValue: number;
      minOrderAmount?: number;
      maxDiscount?: number;
      usageLimit?: number;
      validDays?: number;
    },
  ) {
    const store = await this.prisma.store.findFirst({
      where: { OR: [{ id: storeId }, { slug: storeId }] },
    });
    if (!store) throw new NotFoundException('Tienda no encontrada');

    const normalizedCode = data.code.toUpperCase().trim();
    const existing = await this.prisma.coupon.findUnique({
      where: { code: normalizedCode },
    });
    if (existing) {
      throw new BadRequestException(`El cupón con código "${normalizedCode}" ya existe.`);
    }

    const validDays = data.validDays ? Number(data.validDays) : 30;
    const validUntil = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000);

    return this.prisma.coupon.create({
      data: {
        code: normalizedCode,
        storeId: store.id,
        discountType: data.discountType || 'PERCENT',
        discountValue: Number(data.discountValue),
        minOrderAmount: data.minOrderAmount ? Number(data.minOrderAmount) : 0,
        maxDiscount: data.maxDiscount ? Number(data.maxDiscount) : null,
        usageLimit: data.usageLimit ? Number(data.usageLimit) : 100,
        validUntil,
        isActive: true,
      },
    });
  }

  async deleteCoupon(storeId: string, couponId: string) {
    return this.prisma.coupon.delete({
      where: { id: couponId },
    });
  }

  async validateCoupon(code: string, storeId?: string, orderAmount: number = 0) {
    const normalized = code.toUpperCase().trim();
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: normalized },
      include: { store: true },
    });

    if (!coupon || !coupon.isActive) {
      throw new BadRequestException('El código de cupón no es válido o ha sido desactivado.');
    }

    if (new Date() > coupon.validUntil) {
      throw new BadRequestException('El cupón ha expirado.');
    }

    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      throw new BadRequestException('El cupón ha alcanzado el límite máximo de usos.');
    }

    if (coupon.minOrderAmount && orderAmount < coupon.minOrderAmount) {
      throw new BadRequestException(
        `El pedido mínimo para aplicar este cupón es de Bs. ${coupon.minOrderAmount}.`,
      );
    }

    if (coupon.storeId && storeId && coupon.storeId !== storeId) {
      throw new BadRequestException(
        `Este cupón es exclusivo para compras en la tienda ${coupon.store?.name}.`,
      );
    }

    let calculatedDiscount = 0;
    if (coupon.discountType === 'PERCENT') {
      calculatedDiscount = (orderAmount * coupon.discountValue) / 100;
      if (coupon.maxDiscount && calculatedDiscount > coupon.maxDiscount) {
        calculatedDiscount = coupon.maxDiscount;
      }
    } else {
      calculatedDiscount = Math.min(orderAmount, coupon.discountValue);
    }

    return {
      valid: true,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      calculatedDiscount: Math.round(calculatedDiscount * 100) / 100,
      storeName: coupon.store?.name,
      message: `¡Cupón ${coupon.code} aplicado con éxito! Descuento de Bs. ${calculatedDiscount.toFixed(2)}`,
    };
  }
}
