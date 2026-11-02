import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { DspService } from '../dsp/dsp.service';
import { NotificationsService, type OrderEvent } from '../notifications/notifications.service';
import { effectivePrice } from '../products/pricing';
import { parseVariants } from '../products/variants';
import { isBookableWindow, windowLabel } from '../stores/delivery-schedule';

/** The driver is requested this long before the window starts, so they reach the store on time. */
export const DISPATCH_BEFORE_MINUTES = 20;
export const PAYMENT_METHODS = ['CASH_ON_DELIVERY', 'QR_ON_DELIVERY', 'QR_PREPAID'] as const;
/** Paid on delivery: the payment is collected when the order is delivered. */
const PAY_ON_DELIVERY = ['CASH_ON_DELIVERY', 'QR_ON_DELIVERY'];
/** Customer-visible step reached with each status, for their notifications. */
const STATUS_EVENT: Record<string, OrderEvent> = {
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
};
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
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(limit: number = 20) {
    return this.prisma.order.findMany({
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

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
          include: { store: true },
        },
      },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
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

    const [order] = await this.prisma.$transaction([
      this.prisma.order.create({
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
      }),
      ...[...byId.values()].map((e) =>
        this.prisma.productOffer.update({
          where: { id: e.offer.id },
          data: {
            stock: { decrement: e.taken },
            ...(e.variants.length && { variants: JSON.stringify(e.variants) }),
          },
        }),
      ),
    ]);
    await this.notifications.notifyOrder(order, 'ORDER_CREATED');
    return order;
  }

  /**
   * "Ya pagué" on a QR_PREPAID order. There is no bank integration yet, so this only works with
   * PAYMENTS_TEST_MODE=true: the customer's word marks the order as paid.
   */
  async confirmPayment(idOrNumber: string) {
    if (process.env.PAYMENTS_TEST_MODE !== 'true')
      throw new ForbiddenException('El pago con QR todavía no está conectado a un banco. Paga al recibir.');
    const order = await this.prisma.order.findFirst({ where: { OR: [{ id: idOrNumber }, { orderNumber: idOrNumber }] } });
    if (!order) throw new NotFoundException(`Orden ${idOrNumber} no encontrada`);
    if (order.paymentMethod !== 'QR_PREPAID') throw new BadRequestException('Este pedido se paga al recibir');
    if (order.status === 'CANCELLED') throw new BadRequestException('Este pedido fue cancelado');
    if (order.paymentStatus === 'PAID') return this.findByIdOrNumber(order.id);
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus: 'PAID', paidAt: new Date() },
    });
    await this.notifications.notifyOrder(updated, 'PAYMENT_CONFIRMED');
    return this.findByIdOrNumber(order.id);
  }

  /** Requests the driver for scheduled orders whose window is about to start. */
  @Interval(60_000)
  async dispatchDueOrders(now = new Date()) {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      // Stores that deliver with their own people never go to OpenDSP; prepaid orders wait for the payment.
      const ownDelivery = await this.prisma.store.findMany({ where: { openDspEnabled: false }, select: { id: true } });
      const due = await this.prisma.order.findMany({
        where: {
          status: 'SCHEDULED',
          dispatchedAt: null,
          deliveryAt: { lte: new Date(now.getTime() + DISPATCH_BEFORE_MINUTES * 60_000) },
          storeId: { notIn: ownDelivery.map((s) => s.id) },
          NOT: { paymentMethod: 'QR_PREPAID', paymentStatus: { not: 'PAID' } },
        },
        include: { items: true },
        take: 20,
      });
      for (const order of due) {
        try {
          await this.dispatch(order);
        } catch (error) {
          this.logger.warn(`No se pudo despachar el pedido ${order.orderNumber}: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      this.logger.warn(`No se pudieron despachar pedidos programados: ${(error as Error).message}`);
    } finally {
      this.dispatching = false;
    }
  }

  /** Sends one order to OpenDSP now (the admin's "Pedir repartidor" button, or the scheduler). */
  async dispatchNow(idOrNumber: string) {
    const order = await this.prisma.order.findFirst({ where: { OR: [{ id: idOrNumber }, { orderNumber: idOrNumber }] } });
    if (!order) throw new NotFoundException(`Orden ${idOrNumber} no encontrada`);
    if (order.dspOrderId) return order;
    if (!['SCHEDULED', 'CONFIRMED', 'PREPARING'].includes(order.status))
      throw new BadRequestException('Este pedido ya no se puede enviar a reparto');
    if (order.paymentMethod === 'QR_PREPAID' && order.paymentStatus !== 'PAID')
      throw new BadRequestException('El cliente todavía no pagó con QR');
    const store = order.storeId ? await this.prisma.store.findUnique({ where: { id: order.storeId } }) : null;
    if (store && !store.openDspEnabled)
      throw new BadRequestException('Esta tienda entrega con sus propios repartidores (OpenDSP desactivado en la tienda)');
    const updated = await this.dispatch(order);
    if (!updated) throw new BadRequestException('OpenDSP no respondió. Inténtalo de nuevo en un momento.');
    return updated;
  }

  private async dispatch(order: { id: string; orderNumber: string; storeId: string | null; [key: string]: any }) {
    const store = order.storeId
      ? await this.prisma.store.findUnique({ where: { id: order.storeId } })
      : null;
    if (!store) return null;
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
      paid: order.paymentStatus === 'PAID',
      deliveryAt: order.deliveryAt,
      deliveryWindow: order.deliveryWindow,
    });
    // Core unreachable: the order stays SCHEDULED and the next scheduler pass retries it.
    if (!response) return null;
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'DSP_DISPATCHED',
        dispatchedAt: new Date(),
        dspOrderId: response.dspOrderId,
        dspTrackingToken: response.trackingToken,
        dspTrackingUrl: response.trackingUrl,
        dspDriverName: response.driver?.name ?? null,
        dspDriverPhone: response.driver?.phone ?? null,
        dspDriverRating: response.driver?.rating ?? null,
        dspDriverPhoto: response.driver?.photoUrl ?? null,
        dspEstimatedMinutes: response.estimatedMinutes,
      },
      include: { items: true },
    });
    await this.notifications.notifyOrder(updated, 'DISPATCHED');
    return updated;
  }

  async updateStatus(idOrNumber: string, newStatus: string) {
    const validStatuses = ['PENDING', 'SCHEDULED', 'CONFIRMED', 'PREPARING', 'DSP_DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
    if (!validStatuses.includes(newStatus)) {
      throw new BadRequestException(`Estado no válido: ${newStatus}. Estados válidos: ${validStatuses.join(', ')}`);
    }

    const order = await this.prisma.order.findFirst({
      where: {
        OR: [{ id: idOrNumber }, { orderNumber: idOrNumber }],
      },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException(`Orden ${idOrNumber} no encontrada`);
    }

    if (order.status === 'CANCELLED' && newStatus !== 'CANCELLED') {
      throw new BadRequestException('No se puede modificar el estado de una orden cancelada');
    }

    const delivered = newStatus === 'DELIVERED' && order.status !== 'DELIVERED';
    const updatedOrder = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: newStatus,
        // Cash or QR on delivery is collected by the driver at the door.
        ...(delivered && PAY_ON_DELIVERY.includes(order.paymentMethod) && order.paymentStatus !== 'PAID' && { paymentStatus: 'PAID', paidAt: new Date() }),
      },
      include: { items: true },
    });
    if (newStatus !== order.status && STATUS_EVENT[newStatus]) await this.notifications.notifyOrder(updatedOrder, STATUS_EVENT[newStatus]);

    // Si el estado pasa a DELIVERED, abonar las ganancias a la billetera de la tienda
    if (newStatus === 'DELIVERED' && order.status !== 'DELIVERED' && order.vendorEarnings) {
      const primaryStoreId = order.storeId || order.items?.[0]?.storeId;
      if (primaryStoreId) {
        const store = await this.prisma.store.findUnique({ where: { id: primaryStoreId } });
        if (store) {
          await this.prisma.store.update({
            where: { id: primaryStoreId },
            data: {
              walletBalance: Number((store.walletBalance + order.vendorEarnings).toFixed(2)),
              salesCount: store.salesCount + 1,
            },
          });
        }
      }
    }

    return updatedOrder;
  }

  /**
   * Status updates from OpenDSP Core. Core sends { event, data: { order_id, merchant_reference, status, driver } };
   * the flat { orderId | externalOrderId, status } shape is still accepted for manual calls.
   */
  async handleDspWebhook(payload: any) {
    const data = payload?.data ?? payload ?? {};
    const event: string = payload?.event ?? '';
    const orderRef = data.merchant_reference || data.externalOrderId || payload?.externalOrderId;
    const dspOrderId = data.order_id || data.orderId || payload?.orderId;
    if (!orderRef && !dspOrderId) {
      throw new BadRequestException('Webhook payload sin referencia de orden');
    }

    const order = await this.prisma.order.findFirst({
      where: { OR: [orderRef && { orderNumber: orderRef }, dspOrderId && { dspOrderId }, dspOrderId && { id: dspOrderId }].filter(Boolean) as any },
    });
    if (!order) throw new NotFoundException(`Orden ${orderRef || dspOrderId} no encontrada`);

    const status: string = data.status ?? payload?.status ?? '';
    if (data.driver?.name || data.tracking_url) {
      const withDriver = await this.prisma.order.update({
        where: { id: order.id },
        data: {
          ...(data.driver?.name && { dspDriverName: data.driver.name, dspDriverPhone: data.driver.phone ?? null, dspDriverRating: null }),
          ...(data.tracking_url && { dspTrackingUrl: data.tracking_url }),
        },
      });
      if (data.driver?.name && data.driver.name !== order.dspDriverName) await this.notifications.notifyOrder(withDriver, 'DRIVER_ASSIGNED');
    }

    // Core cancelling only drops the driver; the customer's order stays open for the admin to resend it.
    if (status === 'CANCELLED' || event === 'order.cancelled') {
      return this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'SCHEDULED', dispatchedAt: null, dspOrderId: null, dspTrackingToken: null, dspDriverName: null, dspDriverPhone: null },
        include: { items: true },
      });
    }

    const targetStatus =
      status === 'DELIVERED' || event === 'order.delivered'
        ? 'DELIVERED'
        : status === 'IN_TRANSIT' || status === 'PICKED_UP' || event === 'order.in_transit'
          ? 'IN_TRANSIT'
          : 'DSP_DISPATCHED';
    if (order.status === targetStatus) return this.findByIdOrNumber(order.id);
    return this.updateStatus(order.id, targetStatus);
  }
}
