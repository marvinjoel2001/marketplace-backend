import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type OrderEvent =
  | 'ORDER_CREATED'
  | 'PAYMENT_CONFIRMED'
  | 'DISPATCHED'
  | 'DRIVER_ASSIGNED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'CANCELLED';

interface OrderLike {
  id: string;
  orderNumber: string;
  userId: string | null;
  deliveryWindow?: string | null;
  dspDriverName?: string | null;
  dspTrackingUrl?: string | null;
}

/** Customer-facing copy for each step of an order. */
function message(event: OrderEvent, o: OrderLike): { title: string; body: string; link: string } {
  const page = `/pedido/${o.orderNumber}`;
  switch (event) {
    case 'ORDER_CREATED':
      return { title: 'Recibimos tu pedido', body: `Pedido ${o.orderNumber}${o.deliveryWindow ? `, entrega ${o.deliveryWindow}` : ''}. Te avisamos cada paso.`, link: page };
    case 'PAYMENT_CONFIRMED':
      return { title: 'Pago recibido', body: `Tu pago del pedido ${o.orderNumber} quedó confirmado.`, link: page };
    case 'DISPATCHED':
      return {
        title: 'Buscando repartidor',
        body: `Tu pedido ${o.orderNumber} ya está en reparto.${o.dspTrackingUrl ? ' Toca para seguirlo en el mapa.' : ''}`,
        link: o.dspTrackingUrl || page,
      };
    case 'DRIVER_ASSIGNED':
      return {
        title: `${o.dspDriverName || 'Un repartidor'} lleva tu pedido`,
        body: `Va a recoger el pedido ${o.orderNumber} en la tienda.`,
        link: o.dspTrackingUrl || page,
      };
    case 'IN_TRANSIT':
      return { title: 'Tu pedido va en camino', body: `El pedido ${o.orderNumber} salió de la tienda hacia tu dirección.`, link: o.dspTrackingUrl || page };
    case 'DELIVERED':
      return { title: 'Pedido entregado', body: `Entregamos el pedido ${o.orderNumber}. ¡Gracias por comprar en Vitrina!`, link: page };
    case 'CANCELLED':
      return { title: 'Pedido cancelado', body: `El pedido ${o.orderNumber} fue cancelado. Si ya pagaste, la tienda te contactará.`, link: page };
  }
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Leaves a message in the customer's account. Orders placed without a session have nobody to notify. */
  async notifyOrder(order: OrderLike, event: OrderEvent) {
    if (!order.userId) return;
    try {
      await this.prisma.notification.create({
        data: { userId: order.userId, orderId: order.id, kind: event, ...message(event, order) },
      });
    } catch (err) {
      // A failed notification must never break the order flow.
      this.logger.warn(`No se pudo guardar la notificación ${event} del pedido ${order.orderNumber}: ${(err as Error).message}`);
    }
  }

  async forUser(userId: string) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { unread, items };
  }

  async markAllRead(userId: string) {
    const { count } = await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { updated: count };
  }
}
