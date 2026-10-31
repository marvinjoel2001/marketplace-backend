import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { DspService } from '../dsp/dsp.service';
import { effectivePrice } from '../products/pricing';
import { parseVariants } from '../products/variants';
import { isBookableWindow, windowLabel } from '../stores/delivery-schedule';

/** The driver is requested this long before the window starts, so they reach the store on time. */
export const DISPATCH_BEFORE_MINUTES = 20;
export const PAYMENT_METHODS = ['CASH_ON_DELIVERY', 'QR_ON_DELIVERY'] as const;
const COMMISSION_RATE = 0.05;

export interface CreateOrderDto {
  userId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  customerReference?: string;
  customerLat?: number | string;
  customerLng?: number | string;
  paymentMethod?: string;
  deliveryAt?: string;
  items: { productOfferId?: string; quantity?: number | string; variant?: string }[];
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private dispatching = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dspService: DspService,
  ) {}

  async findByUser(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async findByIdOrNumber(idOrNumber: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [{ id: idOrNumber }, { orderNumber: idOrNumber }, { dspTrackingToken: idOrNumber }],
      },
      include: {
        items: {
          include: { store: { select: { id: true, name: true, slug: true, logo: true, phone: true, address: true, ownerId: true } } },
        },
      },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return order;
  }

  /** An order is visible to the customer who placed it and to the owner of the store that sells it. */
  async findForViewer(idOrNumber: string, userId: string) {
    const order = await this.findByIdOrNumber(idOrNumber);
    const isStore = order.items.some((item) => item.store?.ownerId === userId);
    if (order.userId !== userId && !isStore) throw new NotFoundException('Pedido no encontrado');
    return order;
  }

  /**
   * Creates one order for one store. Prices, stock and shipping come from the database and the
   * delivery quote, never from the client; the delivery window must be one the store offers.
   */
  async create(data: CreateOrderDto) {
    const items = Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) throw new BadRequestException('El carrito no tiene productos');

    const name = String(data.customerName ?? '').trim();
    const phone = String(data.customerPhone ?? '').trim();
    const address = String(data.customerAddress ?? '').trim();
    const lat = Number(data.customerLat);
    const lng = Number(data.customerLng);
    if (!name || !phone || !address)
      throw new BadRequestException('Faltan tu nombre, teléfono o dirección de entrega');
    if (!Number.isFinite(lat) || !Number.isFinite(lng))
      throw new BadRequestException('Marca tu dirección en el mapa');

    const paymentMethod = PAYMENT_METHODS.includes(data.paymentMethod as never)
      ? (data.paymentMethod as string)
      : 'CASH_ON_DELIVERY';

    // One cart line per product and option (size, voltage, ...).
    const wanted = new Map<string, { offerId: string; variant: string; quantity: number }>();
    for (const item of items) {
      const id = String(item.productOfferId ?? '');
      const qty = Number(item.quantity ?? 1);
      const variant = String(item.variant ?? '').trim();
      if (!id || !Number.isInteger(qty) || qty < 1 || qty > 99)
        throw new BadRequestException('Revisa las cantidades del carrito');
      const key = `${id}::${variant.toLocaleLowerCase('es')}`;
      const line = wanted.get(key) ?? { offerId: id, variant, quantity: 0 };
      line.quantity += qty;
      wanted.set(key, line);
    }
    const offerIds = [...new Set([...wanted.values()].map((w) => w.offerId))];

    const offers = await this.prisma.productOffer.findMany({
      where: { id: { in: offerIds } },
      include: { product: true, store: true },
    });
    if (offers.length !== offerIds.length || offers.some((o) => !o.isActive || o.store.status !== 'ACTIVE'))
      throw new BadRequestException('Algún producto del carrito ya no está disponible');

    const store = offers[0].store;
    if (offers.some((o) => o.storeId !== store.id))
      throw new BadRequestException('Cada pedido debe ser de una sola tienda');

    const byId = new Map(offers.map((o) => [o.id, { offer: o, variants: parseVariants(o.variants), taken: 0 }]));
    for (const w of wanted.values()) {
      const entry = byId.get(w.offerId)!;
      const title = entry.offer.product.title;
      if (entry.variants.length) {
        const option = entry.variants.find((v) => v.label.toLocaleLowerCase('es') === w.variant.toLocaleLowerCase('es'));
        if (!option) throw new BadRequestException(`Elige ${(entry.offer.variantAxis || 'una opción').toLowerCase()} para "${title}"`);
        if (w.quantity > option.stock)
          throw new BadRequestException(`Solo quedan ${option.stock} de "${title}" (${option.label})`);
        option.stock -= w.quantity;
        w.variant = option.label;
      } else {
        w.variant = '';
      }
      entry.taken += w.quantity;
      if (entry.taken > entry.offer.stock)
        throw new BadRequestException(`Solo quedan ${entry.offer.stock} de "${title}"`);
    }

    if (!store.paymentMethods.split(',').includes(paymentMethod))
      throw new BadRequestException('Esta tienda no acepta ese método de pago. Elige otro.');

    const deliveryAt = new Date(String(data.deliveryAt ?? ''));
    if (!isBookableWindow(store, deliveryAt))
      throw new BadRequestException('Elige un horario de entrega disponible para esta tienda');

    const lines = [...wanted.values()].map((w) => {
      const offer = byId.get(w.offerId)!.offer;
      const quantity = w.quantity;
      const unitPrice = effectivePrice(offer);
      let image = '';
      try {
        image = JSON.parse(offer.product.images || '[]')[0] || '';
      } catch {
        image = offer.product.images || '';
      }
      return { offer, variant: w.variant || null, quantity, unitPrice, subtotal: Math.round(unitPrice * quantity * 100) / 100, image };
    });

    const subtotal = Math.round(lines.reduce((sum, l) => sum + l.subtotal, 0) * 100) / 100;
    const quote = await this.dspService.getQuote({
      pickupLat: store.latitude,
      pickupLng: store.longitude,
      dropoffLat: lat,
      dropoffLng: lng,
      storeId: store.id,
    });
    const shippingFee = quote.price;
    // customCommissionRate is a percentage set from /admin; without it the platform rate applies.
    const commissionRate = store.customCommissionRate != null ? store.customCommissionRate / 100 : COMMISSION_RATE;
    const platformCommission = Number((subtotal * commissionRate).toFixed(2));
    const vendorEarnings = Number((subtotal - platformCommission).toFixed(2));
    const orderNumber = `VT-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;

    // Stock is taken inside the transaction and only if it is still there, so two buyers can't get the last unit.
    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          orderNumber,
          userId: data.userId || null,
          customerName: name,
          customerEmail: String(data.customerEmail ?? ''),
          customerPhone: phone,
          customerAddress: address,
          customerReference: String(data.customerReference ?? '').trim() || null,
          customerLat: lat,
          customerLng: lng,
          paymentMethod,
          paymentStatus: 'PENDING',
          subtotal,
          shippingFee,
          totalAmount: Math.round((subtotal + shippingFee) * 100) / 100,
          platformCommission,
          vendorEarnings,
          status: 'SCHEDULED',
          storeId: store.id,
          deliveryAt,
          deliveryWindow: windowLabel(deliveryAt),
          dspQuoteId: quote.quoteId,
          dspDriverName: null,
          dspDriverPhone: null,
          dspDriverRating: null,
          dspEstimatedMinutes: quote.estimatedMinutes,
          items: {
            create: lines.map((l) => ({
              productOfferId: l.offer.id,
              storeId: store.id,
              productTitle: l.offer.product.title,
              variant: l.variant,
              storeName: store.name,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              subtotal: l.subtotal,
              productImage: l.image,
            })),
          },
        },
        include: { items: true },
      });
      for (const e of byId.values()) {
        const taken = await tx.productOffer.updateMany({
          where: {
            id: e.offer.id,
            stock: { gte: e.taken },
            ...(e.variants.length ? { variants: e.offer.variants } : {}),
          },
          data: {
            stock: { decrement: e.taken },
            ...(e.variants.length && { variants: JSON.stringify(e.variants) }),
          },
        });
        if (taken.count !== 1)
          throw new ConflictException(`Alguien acaba de comprar "${e.offer.product.title}". Revisa tu carrito e inténtalo otra vez.`);
      }
      return created;
    });
    return order;
  }

  /** Requests the driver for scheduled orders whose window is about to start. */
  @Interval(60_000)
  async dispatchDueOrders(now = new Date()) {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const due = await this.prisma.order.findMany({
        where: {
          status: 'SCHEDULED',
          dispatchedAt: null,
          deliveryAt: { lte: new Date(now.getTime() + DISPATCH_BEFORE_MINUTES * 60_000) },
        },
        include: { items: true },
        take: 20,
      });
      for (const order of due) {
        // One failing order (OpenDSP down, bad address) must not hold back the others; it is retried next minute.
        await this.dispatch(order).catch((error: Error) =>
          this.logger.warn(`Pedido ${order.orderNumber}: OpenDSP no aceptó el despacho (${error.message}). Se reintenta.`),
        );
      }
    } catch (error) {
      this.logger.warn(`No se pudieron despachar pedidos programados: ${(error as Error).message}`);
    } finally {
      this.dispatching = false;
    }
  }

  private async dispatch(order: { id: string; orderNumber: string; storeId: string | null; [key: string]: any }) {
    const store = order.storeId
      ? await this.prisma.store.findUnique({ where: { id: order.storeId } })
      : null;
    if (!store) return;
    const response = await this.dspService.dispatchOrder({
      quoteId: order.dspQuoteId || `dsp_q_${Date.now()}`,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerAddress: [order.customerAddress, order.customerReference].filter(Boolean).join(' — '),
      customerLat: order.customerLat,
      customerLng: order.customerLng,
      storeName: store.name,
      storeAddress: [store.address, store.addressReference].filter(Boolean).join(' — '),
      storeLat: store.latitude,
      storeLng: store.longitude,
      totalAmount: order.totalAmount,
      paymentMethod: order.paymentMethod,
    });
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'DSP_DISPATCHED',
        dispatchedAt: new Date(),
        dspOrderId: response.dspOrderId,
        dspTrackingToken: response.trackingToken,
        dspDriverName: response.driver?.name ?? null,
        dspDriverPhone: response.driver?.phone ?? null,
        dspDriverRating: response.driver?.rating ?? null,
        dspDriverPhoto: response.driver?.photoUrl ?? null,
        dspEstimatedMinutes: response.estimatedMinutes,
      },
    });
  }

  /**
   * Sets an order's status (SCHEDULED → PREPARING → DSP_DISPATCHED → IN_TRANSIT → DELIVERED, or CANCELLED). Delivered and cancelled
   * orders are final. The store is credited exactly once (when the order becomes DELIVERED) and a cancellation puts
   * the units back in stock; both happen in the same transaction as the status change, which only applies if nobody
   * changed the order in between.
   */
  async updateStatus(idOrNumber: string, newStatus: string, extra: Prisma.OrderUpdateInput = {}) {
    if (!ORDER_STATUSES.includes(newStatus as never)) {
      throw new BadRequestException(`Estado no válido: ${newStatus}. Estados válidos: ${ORDER_STATUSES.join(', ')}`);
    }

    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: idOrNumber }, { orderNumber: idOrNumber }] },
      include: { items: true },
    });
    if (!order) throw new NotFoundException(`Orden ${idOrNumber} no encontrada`);
    if (order.status === newStatus) return order;
    if (order.status === 'CANCELLED') throw new BadRequestException('No se puede modificar el estado de una orden cancelada');
    if (order.status === 'DELIVERED') throw new BadRequestException('El pedido ya fue entregado');

    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { status: newStatus } });
      if (changed.count !== 1) throw new ConflictException('El pedido cambió mientras tanto. Vuelve a intentarlo.');

      const storeId = order.storeId || order.items[0]?.storeId;
      if (newStatus === 'DELIVERED' && storeId) {
        await tx.store.update({
          where: { id: storeId },
          data: { walletBalance: { increment: order.vendorEarnings ?? 0 }, salesCount: { increment: 1 } },
        });
      }
      if (newStatus === 'CANCELLED') await this.restock(tx, order.items);

      return tx.order.update({ where: { id: order.id }, data: extra, include: { items: true } });
    });
  }

  /** Puts the units of a cancelled order back, including the option (size, voltage, ...) they were bought in. */
  private async restock(tx: Prisma.TransactionClient, items: { productOfferId: string | null; quantity: number; variant: string | null }[]) {
    for (const item of items) {
      if (!item.productOfferId) continue;
      const offer = await tx.productOffer.findUnique({ where: { id: item.productOfferId } });
      if (!offer) continue;
      const variants = parseVariants(offer.variants);
      const option = item.variant ? variants.find((v) => v.label.toLocaleLowerCase('es') === item.variant!.toLocaleLowerCase('es')) : undefined;
      if (option) option.stock += item.quantity;
      await tx.productOffer.update({
        where: { id: offer.id },
        data: { stock: { increment: item.quantity }, ...(option && { variants: JSON.stringify(variants) }) },
      });
    }
  }

  /**
   * Status updates OpenDSP posts to this backend: `{ event, timestamp, data: { order_id, merchant_reference, status, driver } }`,
   * signed by the caller (checked in the controller). Events only move the order forward.
   */
  async handleDspWebhook(payload: DspWebhookPayload) {
    const data = payload?.data ?? {};
    const ref = data.merchant_reference || data.order_id;
    if (!payload?.event || !ref) throw new BadRequestException('Webhook sin evento o sin referencia de pedido');

    const order = await this.prisma.order.findFirst({
      where: {
        OR: [
          ...(data.merchant_reference ? [{ orderNumber: data.merchant_reference }] : []),
          ...(data.order_id ? [{ dspOrderId: data.order_id }] : []),
        ],
      },
    });
    if (!order) throw new NotFoundException(`Pedido ${ref} no encontrado`);

    const driver: Prisma.OrderUpdateInput = data.driver?.name
      ? { dspDriverName: data.driver.name, dspDriverPhone: data.driver.phone ?? null }
      : {};
    const target = DSP_EVENT_STATUS[payload.event];
    if (payload.event === 'order.cancelled') {
      // The courier side gave up: the order goes back to the queue and is dispatched again.
      if (order.status === 'DSP_DISPATCHED' || order.status === 'IN_TRANSIT') {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'SCHEDULED', dispatchedAt: null, dspOrderId: null, dspDriverName: null, dspDriverPhone: null },
        });
      }
      return { ok: true };
    }
    if (!target || STATUS_RANK[target] <= (STATUS_RANK[order.status] ?? -1)) {
      if (Object.keys(driver).length) await this.prisma.order.update({ where: { id: order.id }, data: driver });
      return { ok: true };
    }
    await this.updateStatus(order.id, target, driver);
    return { ok: true };
  }
}

export const ORDER_STATUSES = ['SCHEDULED', 'CONFIRMED', 'PREPARING', 'DSP_DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'] as const;
const STATUS_RANK: Record<string, number> = { SCHEDULED: 0, CONFIRMED: 0, PREPARING: 1, DSP_DISPATCHED: 2, IN_TRANSIT: 3, DELIVERED: 4 };
const DSP_EVENT_STATUS: Record<string, string> = {
  'order.assigned': 'DSP_DISPATCHED',
  'order.arrived_pickup': 'DSP_DISPATCHED',
  'order.in_transit': 'IN_TRANSIT',
  'order.delivered': 'DELIVERED',
};

export interface DspWebhookPayload {
  event?: string;
  timestamp?: string;
  data?: {
    order_id?: string;
    merchant_reference?: string;
    status?: string;
    driver?: { name?: string; phone?: string };
  };
}
