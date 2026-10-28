import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { DspService } from '../dsp/dsp.service';
import { effectivePrice } from '../products/pricing';
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
  items: { productOfferId?: string; quantity?: number | string }[];
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private dispatching = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dspService: DspService,
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

    const quantities = new Map<string, number>();
    for (const item of items) {
      const id = String(item.productOfferId ?? '');
      const qty = Number(item.quantity ?? 1);
      if (!id || !Number.isInteger(qty) || qty < 1 || qty > 99)
        throw new BadRequestException('Revisa las cantidades del carrito');
      quantities.set(id, (quantities.get(id) ?? 0) + qty);
    }

    const offers = await this.prisma.productOffer.findMany({
      where: { id: { in: [...quantities.keys()] } },
      include: { product: true, store: true },
    });
    if (offers.length !== quantities.size || offers.some((o) => !o.isActive || o.store.status !== 'ACTIVE'))
      throw new BadRequestException('Algún producto del carrito ya no está disponible');

    const store = offers[0].store;
    if (offers.some((o) => o.storeId !== store.id))
      throw new BadRequestException('Cada pedido debe ser de una sola tienda');
    for (const offer of offers) {
      if ((quantities.get(offer.id) ?? 0) > offer.stock)
        throw new BadRequestException(`Solo quedan ${offer.stock} de "${offer.product.title}"`);
    }

    const deliveryAt = new Date(String(data.deliveryAt ?? ''));
    if (!isBookableWindow(store, deliveryAt))
      throw new BadRequestException('Elige un horario de entrega disponible para esta tienda');

    const lines = offers.map((offer) => {
      const quantity = quantities.get(offer.id) ?? 1;
      const unitPrice = effectivePrice(offer);
      let image = '';
      try {
        image = JSON.parse(offer.product.images || '[]')[0] || '';
      } catch {
        image = offer.product.images || '';
      }
      return { offer, quantity, unitPrice, subtotal: Math.round(unitPrice * quantity * 100) / 100, image };
    });

    const subtotal = Math.round(lines.reduce((sum, l) => sum + l.subtotal, 0) * 100) / 100;
    const quote = await this.dspService.getQuote({
      pickupLat: store.latitude,
      pickupLng: store.longitude,
      dropoffLat: lat,
      dropoffLng: lng,
    });
    const shippingFee = quote.price;
    const platformCommission = Number((subtotal * COMMISSION_RATE).toFixed(2));
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
      ...lines.map((l) =>
        this.prisma.productOffer.update({
          where: { id: l.offer.id },
          data: { stock: { decrement: l.quantity } },
        }),
      ),
    ]);
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
      for (const order of due) await this.dispatch(order);
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

    const updatedOrder = await this.prisma.order.update({
      where: { id: order.id },
      data: { status: newStatus },
      include: { items: true },
    });

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

  async handleDspWebhook(payload: any) {
    const { event, orderId, externalOrderId, status } = payload;
    const orderRef = externalOrderId || orderId;

    if (!orderRef) {
      throw new BadRequestException('Webhook payload sin referencia de orden');
    }

    const targetStatus = status === 'DELIVERED' || event === 'order.delivered'
      ? 'DELIVERED'
      : status === 'PICKED_UP' || event === 'order.in_transit'
        ? 'IN_TRANSIT'
        : status || 'DSP_DISPATCHED';

    return this.updateStatus(orderRef, targetStatus);
  }
}
