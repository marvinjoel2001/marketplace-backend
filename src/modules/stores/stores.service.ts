import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LIVE_TTL_SECONDS } from '../tiktok-lives/tiktok-lives.types';
import { normalizeSchedule } from './delivery-schedule';
import { normalizeAxis, normalizeVariants, parseVariants, totalStock } from '../products/variants';

/** Columns only the owner and the admin see: payout details, balance, commissions and who owns the store. */
const PRIVATE_STORE_FIELDS = [
  'walletBalance',
  'bankAccountInfo',
  'payoutQr',
  'ownerId',
  'customCommissionRate',
  'shippingBaseFare',
  'shippingPerKm',
  'statusReason',
] as const;

export function publicStore<T extends object>(store: T): Omit<T, (typeof PRIVATE_STORE_FIELDS)[number]> {
  const out = { ...store } as Record<string, unknown>;
  for (const key of PRIVATE_STORE_FIELDS) delete out[key];
  return out as Omit<T, (typeof PRIVATE_STORE_FIELDS)[number]>;
}

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

    const stores = await this.prisma.store.findMany({
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
    return stores.map(publicStore);
  }

  /** The storefront page: only active stores, without private columns. */
  async findBySlugOrId(idOrSlug: string) {
    const store = await this.prisma.store.findFirst({
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

    if (!store || store.status !== 'ACTIVE') throw new NotFoundException('Tienda no encontrada');
    return publicStore(store);
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
    ownerId?: string;
    [key: string]: unknown;
  }) {
    const { name, category, address, ownerId } = data;

    if (!name || !category || !address) {
      throw new BadRequestException('Nombre, categoría y dirección son obligatorios');
    }

    if (ownerId) {
      const owner = await this.prisma.user.findUnique({ where: { id: ownerId } });
      if (!owner) throw new BadRequestException('Inicia sesión antes de crear tu tienda');
      const existing = await this.prisma.store.findFirst({ where: { ownerId } });
      if (existing) return existing;
    }

    if (data.phone) {
      const cleanPhone = String(data.phone).trim();
      if (cleanPhone) {
        const phoneStore = await this.prisma.store.findFirst({
          where: { phone: cleanPhone, status: { not: 'BANNED' } },
        });
        if (phoneStore && (!ownerId || phoneStore.ownerId !== ownerId)) {
          throw new BadRequestException('Ya existe una tienda registrada con este número de teléfono');
        }
      }
    }

    const slug = `${name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now().toString().slice(-4)}`;
    const settings = this.settingsData(data);

    const store = await this.prisma.store.create({
      data: {
        slug,
        name: String(name).trim(),
        category: String(category),
        address: String(address),
        description: `Tienda ${name}`,
        logo: '',
        isOfficial: false,
        rating: 5.0,
        ownerId: ownerId || null,
        ...settings,
      },
    });

    if (ownerId) {
      await this.prisma.user.update({
        where: { id: ownerId },
        data: { storeId: store.id, role: 'VENDOR' },
      });
    }
    return store;
  }

  async findByOwner(userId: string) {
    const store = await this.prisma.store.findFirst({ where: { ownerId: userId } });
    if (!store) throw new NotFoundException('Este usuario todavía no tiene tienda');
    return store;
  }

  /** Settings the store edits from its panel. Other columns (status, wallet, ownership) stay out of reach. */
  async update(idOrSlug: string, data: Record<string, unknown>) {
    const store = await this.resolve(idOrSlug);
    if (data.phone) {
      const cleanPhone = String(data.phone).trim();
      if (cleanPhone) {
        const phoneStore = await this.prisma.store.findFirst({
          where: { phone: cleanPhone, id: { not: store.id }, status: { not: 'BANNED' } },
        });
        if (phoneStore) throw new BadRequestException('Ya existe otra tienda registrada con este número de teléfono');
      }
    }
    return this.prisma.store.update({
      where: { id: store.id },
      data: this.settingsData(data),
    });
  }

  private settingsData(data: Record<string, unknown>) {
    const out: Record<string, unknown> = {};
    const text = (key: string, max = 300) => {
      if (data[key] === undefined) return;
      const value = data[key] === null ? '' : String(data[key]).trim().slice(0, max);
      out[key] = value;
    };
    text('name', 80);
    text('description', 500);
    text('category', 60);
    text('phone', 30);
    text('address', 300);
    text('addressReference', 300);
    text('logo', 500);
    text('banner', 500);
    text('payoutQr', 500);
    if (out.name === '') throw new BadRequestException('El nombre de la tienda no puede quedar vacío');

    for (const key of ['latitude', 'longitude'] as const) {
      if (data[key] === undefined) continue;
      const value = Number(data[key]);
      const limit = key === 'latitude' ? 90 : 180;
      if (!Number.isFinite(value) || Math.abs(value) > limit)
        throw new BadRequestException('Marca la ubicación de la tienda en el mapa');
      out[key] = value;
    }

    if (data.bankAccountInfo !== undefined) {
      let raw = data.bankAccountInfo as Record<string, unknown> | null;
      if (typeof data.bankAccountInfo === 'string') {
        try {
          raw = JSON.parse(data.bankAccountInfo || '{}');
        } catch {
          throw new BadRequestException('Revisa los datos de tu cuenta bancaria');
        }
      }
      const pick = (k: string) => String(raw?.[k] ?? '').trim().slice(0, 80);
      out.bankAccountInfo = JSON.stringify({
        bank: pick('bank'),
        account: pick('account'),
        holder: pick('holder'),
        document: pick('document'),
      });
    }

    if (data.tiktokUsername !== undefined) {
      const username = String(data.tiktokUsername ?? '').trim().replace(/^@/, '').toLowerCase();
      if (username && !/^[a-z0-9_][a-z0-9_.]{0,23}$/.test(username))
        throw new BadRequestException('Usuario de TikTok inválido');
      out.tiktokUsername = username || null;
      out.tiktokLiveUrl = username ? `https://www.tiktok.com/@${username}/live` : null;
    }

    Object.assign(
      out,
      normalizeSchedule({
        deliveryDays: data.deliveryDays as string | undefined,
        deliveryStart: data.deliveryStart as string | undefined,
        deliveryEnd: data.deliveryEnd as string | undefined,
      }),
    );
    return out;
  }

  private async resolve(idOrSlug: string) {
    const store = await this.prisma.store.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    });
    if (!store) throw new NotFoundException('Tienda no encontrada');
    return store;
  }

  // ====================================================
  // EN VIVO, VENTAS Y MÉTRICAS
  // ====================================================

  /** Registered stores that are live right now: started from the panel or seen live on TikTok. */
  async findLive() {
    const fresh = new Date(Date.now() - LIVE_TTL_SECONDS * 1000);
    const stores = await this.prisma.store.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { liveStreams: { some: { status: 'LIVE' } } },
          { discoveredLives: { some: { status: 'ACTIVE', verifiedAt: { gte: fresh } } } },
        ],
      },
      include: {
        liveStreams: { where: { status: 'LIVE' }, orderBy: { startedAt: 'desc' }, take: 1 },
        discoveredLives: { where: { status: 'ACTIVE', verifiedAt: { gte: fresh } }, take: 1 },
        offers: { where: { isActive: true }, include: { product: true } },
      },
    });

    return stores.map((store) => {
      const stream = store.liveStreams[0];
      const tiktok = store.discoveredLives[0];
      const featured = (stream?.featuredProductIds ?? '').split(',').filter(Boolean);
      const offers = featured.length
        ? store.offers.filter((o) => featured.includes(o.productId))
        : store.offers.slice(0, 12);
      return {
        store: {
          id: store.id,
          slug: store.slug,
          name: store.name,
          logo: store.logo,
          tiktokUsername: store.tiktokUsername,
        },
        title: stream?.title || tiktok?.title || `${store.name} en vivo`,
        viewerCount: tiktok?.viewerCount ?? 0,
        coverImageUrl: tiktok?.coverImageUrl ?? null,
        liveUrl: store.tiktokLiveUrl,
        startedAt: stream?.startedAt ?? tiktok?.verifiedAt,
        offers,
      };
    });
  }

  async getOrders(idOrSlug: string, since?: string) {
    const store = await this.resolve(idOrSlug);
    const sinceDate = since ? new Date(since) : null;
    return this.prisma.order.findMany({
      where: {
        OR: [{ storeId: store.id }, { items: { some: { storeId: store.id } } }],
        ...(sinceDate && !Number.isNaN(sinceDate.getTime()) ? { createdAt: { gt: sinceDate } } : {}),
      },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getSummary(idOrSlug: string) {
    const store = await this.resolve(idOrSlug);
    const now = new Date();
    // Day boundaries in Bolivia time (UTC-4).
    const offset = 4 * 60 * 60 * 1000;
    const local = new Date(now.getTime() - offset);
    const startOfDay = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + offset);
    const startOfWeek = new Date(startOfDay.getTime() - ((local.getUTCDay() + 6) % 7) * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + offset);

    const orders = await this.prisma.order.findMany({
      where: {
        OR: [{ storeId: store.id }, { items: { some: { storeId: store.id } } }],
        status: { not: 'CANCELLED' },
        createdAt: { gte: new Date(Math.min(startOfWeek.getTime(), startOfMonth.getTime())) },
      },
      select: { createdAt: true, items: { where: { storeId: store.id }, select: { subtotal: true } } },
    });
    const sum = (from: Date) => {
      const list = orders.filter((o) => o.createdAt >= from);
      return { total: Math.round(list.reduce((s, o) => s + o.items.reduce((amount, item) => amount + item.subtotal, 0), 0) * 100) / 100, count: list.length };
    };

    const [upcoming, products, activeOffers] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          OR: [{ storeId: store.id }, { items: { some: { storeId: store.id } } }],
          status: { in: ['SCHEDULED', 'CONFIRMED', 'PREPARING', 'DSP_DISPATCHED'] },
        },
        include: { items: true },
        orderBy: { deliveryAt: 'asc' },
        take: 5,
      }),
      this.prisma.productOffer.count({ where: { storeId: store.id } }),
      this.prisma.productOffer.count({
        where: { storeId: store.id, isActive: true, isFlashSale: true, flashSaleEnd: { gt: now } },
      }),
    ]);

    return {
      today: sum(startOfDay),
      week: sum(startOfWeek),
      month: sum(startOfMonth),
      upcoming,
      products,
      activeOffers,
    };
  }

  /** Puts several products on sale at once with the same discount and end date. */
  async applyBulkOffer(
    idOrSlug: string,
    data: { offerIds?: string[]; discountPercent?: number | string; endsAt?: string },
  ) {
    const store = await this.resolve(idOrSlug);
    const percent = Number(data.discountPercent);
    if (!Number.isInteger(percent) || percent < 1 || percent > 90)
      throw new BadRequestException('El descuento debe estar entre 1% y 90%');
    const endsAt = new Date(String(data.endsAt));
    const maxEnd = Date.now() + 90 * 24 * 60 * 60 * 1000;
    if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now() || endsAt.getTime() > maxEnd)
      throw new BadRequestException('Elige hasta cuándo dura la oferta (máximo 90 días)');
    const ids = Array.isArray(data.offerIds) ? data.offerIds.map(String) : [];
    if (ids.length === 0) throw new BadRequestException('Elige al menos un producto');

    const offers = await this.prisma.productOffer.findMany({
      where: { id: { in: ids }, storeId: store.id },
    });
    if (offers.length === 0) throw new NotFoundException('Esos productos no son de esta tienda');

    await this.prisma.$transaction(
      offers.flatMap((offer) => [
        this.prisma.productOffer.update({
          where: { id: offer.id },
          data: {
            isFlashSale: true,
            discountPercent: percent,
            salePrice: Math.round(offer.price * (100 - percent)) / 100,
            flashSaleEnd: endsAt,
            promoBadge: 'OFERTA',
          },
        }),
        this.prisma.product.update({
          where: { id: offer.productId },
          data: { isFlashSale: true, flashSaleEnd: endsAt, discountPercent: percent },
        }),
      ]),
    );
    return { updated: offers.length, discountPercent: percent, endsAt };
  }

  async endOffers(idOrSlug: string, offerIds: string[]) {
    const store = await this.resolve(idOrSlug);
    const offers = await this.prisma.productOffer.findMany({
      where: { id: { in: (offerIds ?? []).map(String) }, storeId: store.id },
    });
    await this.prisma.$transaction(
      offers.flatMap((offer) => [
        this.prisma.productOffer.update({
          where: { id: offer.id },
          data: { isFlashSale: false, salePrice: null, discountPercent: 0, flashSaleEnd: null, promoBadge: null },
        }),
        this.prisma.product.update({
          where: { id: offer.productId },
          data: { isFlashSale: false, flashSaleEnd: null, discountPercent: 0 },
        }),
      ]),
    );
    return { updated: offers.length };
  }

  /** Price, stock and visibility of one of the store's products. */
  async updateOffer(
    idOrSlug: string,
    offerId: string,
    data: { price?: number | string; stock?: number | string; isActive?: boolean; variantAxis?: string; variants?: unknown },
  ) {
    const store = await this.resolve(idOrSlug);
    const offer = await this.prisma.productOffer.findFirst({ where: { id: offerId, storeId: store.id } });
    if (!offer) throw new NotFoundException('Producto no encontrado en esta tienda');
    const update: Record<string, unknown> = { stockCheckedAt: new Date() };
    if (data.variants !== undefined) {
      const variants = normalizeVariants(data.variants);
      update.variants = variants ? JSON.stringify(variants) : null;
      update.variantAxis = variants ? normalizeAxis(data.variantAxis) ?? offer.variantAxis ?? 'Opción' : null;
      if (variants) update.stock = totalStock(variants);
    }
    if (data.price !== undefined) {
      const price = Number(data.price);
      if (!Number.isFinite(price) || price <= 0) throw new BadRequestException('El precio debe ser mayor a 0');
      update.price = price;
      if (offer.discountPercent && offer.isFlashSale)
        update.salePrice = Math.round(price * (100 - offer.discountPercent)) / 100;
    }
    // With options the total always comes from them.
    const hasVariants = data.variants !== undefined ? Boolean(update.variants) : parseVariants(offer.variants).length > 0;
    if (data.stock !== undefined && !hasVariants) {
      const stock = Number(data.stock);
      if (!Number.isInteger(stock) || stock < 0) throw new BadRequestException('El stock no puede ser negativo');
      update.stock = stock;
    }
    if (data.isActive !== undefined) update.isActive = Boolean(data.isActive);
    return this.prisma.productOffer.update({
      where: { id: offer.id },
      data: update,
      include: { product: { include: { category: true } } },
    });
  }

  /**
   * "Vendí una" (negative change) and "Llegaron más" (positive) for rotating stock, optionally for
   * one option. A product that runs out is hidden from the shop and shows again when stock comes back.
   */
  async adjustStock(idOrSlug: string, offerId: string, data: { change?: number | string; variant?: string }) {
    const store = await this.resolve(idOrSlug);
    const offer = await this.prisma.productOffer.findFirst({ where: { id: offerId, storeId: store.id } });
    if (!offer) throw new NotFoundException('Producto no encontrado en esta tienda');
    const change = Number(data.change);
    if (!Number.isInteger(change) || change === 0 || Math.abs(change) > 999)
      throw new BadRequestException('Escribe una cantidad válida');

    const variants = parseVariants(offer.variants);
    let stock: number;
    if (variants.length) {
      const label = String(data.variant ?? '').trim();
      const target = variants.find((v) => v.label.toLocaleLowerCase('es') === label.toLocaleLowerCase('es'));
      if (!target) throw new BadRequestException(`Elige ${(offer.variantAxis || 'la opción').toLowerCase()}`);
      if (target.stock + change < 0) throw new BadRequestException(`Ya no te quedan de ${target.label}`);
      target.stock += change;
      stock = totalStock(variants);
    } else {
      if (offer.stock + change < 0) throw new BadRequestException('Ya no te quedan unidades de este producto');
      stock = offer.stock + change;
    }
    return this.prisma.productOffer.update({
      where: { id: offer.id },
      data: {
        stock,
        ...(variants.length && { variants: JSON.stringify(variants) }),
        isActive: stock > 0 ? (change > 0 ? true : offer.isActive) : false,
        stockCheckedAt: new Date(),
      },
      include: { product: { include: { category: true } } },
    });
  }

  /** Answers "¿Sigues teniendo estos?": keep them as they are, or mark them sold out and hide them. */
  async confirmStock(idOrSlug: string, offerIds: string[], stillHave: boolean) {
    const store = await this.resolve(idOrSlug);
    const ids = Array.isArray(offerIds) ? offerIds.map(String).slice(0, 200) : [];
    if (!ids.length) throw new BadRequestException('Elige al menos un producto');
    const offers = await this.prisma.productOffer.findMany({ where: { id: { in: ids }, storeId: store.id } });
    await this.prisma.$transaction(
      offers.map((offer) =>
        this.prisma.productOffer.update({
          where: { id: offer.id },
          data: stillHave
            ? { stockCheckedAt: new Date() }
            : {
                stockCheckedAt: new Date(),
                stock: 0,
                isActive: false,
                ...(offer.variants && { variants: JSON.stringify(parseVariants(offer.variants).map((v) => ({ ...v, stock: 0 }))) }),
              },
        }),
      ),
    );
    return { updated: offers.length };
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
      offer = await this.prisma.productOffer.findFirst({
        where: { id: data.offerId, storeId: store.id },
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
    if (!Number.isFinite(salePrice) || salePrice <= 0 || salePrice >= originalPrice)
      throw new BadRequestException('El precio de oferta debe ser mayor a 0 y menor al precio normal');
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
    const store = await this.resolve(storeId);
    const offer = await this.prisma.productOffer.findFirst({
      where: { id: offerId, storeId: store.id },
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

    const normalizedCode = String(data.code ?? '').toUpperCase().trim();
    const value = Number(data.discountValue);
    if (!normalizedCode) throw new BadRequestException('Escribe el código del cupón');
    if (!Number.isFinite(value) || value <= 0 || (data.discountType !== 'FIXED_AMOUNT' && value > 90))
      throw new BadRequestException('Revisa el descuento del cupón');
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
    const store = await this.resolve(storeId);
    const coupon = await this.prisma.coupon.findFirst({ where: { id: couponId, storeId: store.id } });
    if (!coupon) throw new NotFoundException('Cupón no encontrado');
    return this.prisma.coupon.delete({ where: { id: coupon.id } });
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
