import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DspService } from '../dsp/dsp.service';

@Injectable()
export class OrdersService {
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

  async findByIdOrNumber(idOrNumber: string) {
    let order = await this.prisma.order.findFirst({
      where: {
        OR: [{ id: idOrNumber }, { orderNumber: idOrNumber }, { dspTrackingToken: idOrNumber }],
      },
      include: {
        items: {
          include: { store: true },
        },
      },
    });

    if (!order) {
      // Fallback demo order for interactive tracking
      return {
        id: 'demo-order-id',
        orderNumber: idOrNumber || 'CY-894120-412',
        customerName: 'Juan Pérez',
        customerEmail: 'juan.perez@example.com',
        customerPhone: '+591 77098765',
        customerAddress: 'Av. San Martín, Calle 5 Oeste, Equipetrol, Santa Cruz',
        customerLat: -17.7695,
        customerLng: -63.194,
        paymentMethod: 'QR_SIMPLE',
        paymentStatus: 'PAID',
        totalAmount: 189,
        subtotal: 189,
        shippingFee: 0,
        status: 'IN_TRANSIT',
        dspQuoteId: 'dsp_q_991823',
        dspOrderId: 'dsp_ord_77189',
        dspTrackingToken: 'trk_tok_carlos_mendoza',
        dspDriverName: 'Carlos Mendoza',
        dspDriverPhone: '+591 77012345',
        dspDriverRating: 4.9,
        dspDriverPhoto: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150',
        dspEstimatedMinutes: 18,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [
          {
            id: 'item-1',
            orderId: 'demo-order-id',
            productOfferId: 'off-1',
            storeId: 'store-1',
            productTitle: 'Chompa Oversize Beige - Talla M',
            storeName: 'ModaBol (Tienda Oficial)',
            quantity: 1,
            unitPrice: 189,
            subtotal: 189,
            productImage: 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400',
          },
        ],
      };
    }

    return order;
  }

  async create(data: {
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    customerAddress?: string;
    customerLat?: number;
    customerLng?: number;
    paymentMethod?: string;
    items: any[];
    quoteId?: string;
    shippingFee?: number | string;
  }) {
    const {
      customerName = 'Juan Pérez',
      customerEmail = 'juan.perez@example.com',
      customerPhone = '+591 77098765',
      customerAddress = 'Av. San Martín, Calle 5 Oeste, Equipetrol, Santa Cruz',
      customerLat = -17.7695,
      customerLng = -63.194,
      paymentMethod = 'QR_SIMPLE',
      items,
      quoteId,
      shippingFee = 0,
    } = data;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('El carrito no tiene productos');
    }

    const orderNumber = `CY-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;
    const subtotal = items.reduce((sum: number, item: any) => sum + (item.unitPrice || 0) * (item.quantity || 1), 0);
    const parsedShippingFee = typeof shippingFee === 'string' ? parseFloat(shippingFee) : shippingFee;
    const totalAmount = subtotal + parsedShippingFee;

    // Obtener datos de la tienda para la recogida
    const primaryItem = items[0];
    const storeLat = primaryItem.storeLat || -17.7685;
    const storeLng = primaryItem.storeLng || -63.1952;
    const storeAddress = primaryItem.storeAddress || 'Equipetrol, Santa Cruz';

    // Despacho a OpenDSP
    const dspResponse = await this.dspService.dispatchOrder({
      quoteId: quoteId || `dsp_q_${Date.now()}`,
      orderNumber,
      customerName,
      customerPhone,
      customerAddress,
      customerLat,
      customerLng,
      storeName: primaryItem.storeName || 'Tienda Oficial CompraYa',
      storeAddress,
      storeLat,
      storeLng,
      totalAmount,
      paymentMethod,
    });

    // Guardar orden
    return this.prisma.order.create({
      data: {
        orderNumber,
        customerName,
        customerEmail,
        customerPhone,
        customerAddress,
        customerLat,
        customerLng,
        paymentMethod,
        paymentStatus: 'PAID',
        totalAmount,
        subtotal,
        shippingFee: parsedShippingFee,
        status: 'IN_TRANSIT',
        dspQuoteId: quoteId,
        dspOrderId: dspResponse.dspOrderId,
        dspTrackingToken: dspResponse.trackingToken,
        dspDriverName: dspResponse.driver?.name || 'Carlos Mendoza',
        dspDriverPhone: dspResponse.driver?.phone || '+591 77012345',
        dspDriverRating: dspResponse.driver?.rating || 4.9,
        dspDriverPhoto: dspResponse.driver?.photoUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
        dspEstimatedMinutes: dspResponse.estimatedMinutes || 20,
        items: {
          create: items.map((it: any) => ({
            productOfferId: it.productOfferId || null,
            storeId: it.storeId || 'store-1',
            productTitle: it.productTitle,
            storeName: it.storeName || 'Tienda Oficial',
            quantity: it.quantity || 1,
            unitPrice: it.unitPrice || 0,
            subtotal: (it.unitPrice || 0) * (it.quantity || 1),
            productImage: it.productImage || '',
          })),
        },
      },
      include: {
        items: true,
      },
    });
  }
}
