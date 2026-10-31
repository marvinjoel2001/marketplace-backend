import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from '../orders.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { DspService } from '../../dsp/dsp.service';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: PrismaService;
  let dspService: DspService;

  const mockPrisma: any = {
    order: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    store: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockDspService = {
    getQuote: jest.fn().mockResolvedValue({
      quoteId: 'dsp_q_123',
      price: 15,
      estimatedMinutes: 20,
    }),
    dispatchOrder: jest.fn().mockResolvedValue({
      dspOrderId: 'dsp_ord_123',
      trackingToken: 'trk_tok_123',
      trackingUrl: '/order/track/123',
      status: 'ASSIGNED',
      driver: { name: 'Carlos Mendoza', phone: '+591 77012345' },
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: DspService,
          useValue: mockDspService,
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    prisma = module.get<PrismaService>(PrismaService);
    dspService = module.get<DspService>(DspService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByIdOrNumber', () => {
    it('should find existing order in database', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        orderNumber: 'CY-123456-111',
        customerName: 'Juan',
      });

      const result = await service.findByIdOrNumber('CY-123456-111');
      expect(result.orderNumber).toBe('CY-123456-111');
    });

    it('solo muestra el pedido a quien lo hizo o a la tienda que lo vende', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        orderNumber: 'VT-1',
        userId: 'buyer',
        items: [{ store: { ownerId: 'seller' } }],
      });
      await expect(service.findForViewer('VT-1', 'buyer')).resolves.toMatchObject({ id: 'o1' });
      await expect(service.findForViewer('VT-1', 'seller')).resolves.toMatchObject({ id: 'o1' });
      await expect(service.findForViewer('VT-1', 'stranger')).rejects.toThrow('Pedido no encontrado');
    });

    it('should report a missing order instead of inventing one', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(null);

      await expect(service.findByIdOrNumber('CY-894120-412')).rejects.toThrow('Pedido no encontrado');
    });
  });

  describe('create (TC-ORD-001 & TC-MONEY-001)', () => {
    // Monday 10:00 in Bolivia (UTC-4).
    const NOW = new Date('2026-11-02T14:00:00Z');
    const store = {
      id: 'store-1',
      name: 'ModaBol',
      status: 'ACTIVE',
      latitude: -17.78,
      longitude: -63.18,
      deliveryDays: '1,2,3,4,5',
      deliveryStart: '09:00',
      deliveryEnd: '18:00',
      paymentMethods: 'CASH_ON_DELIVERY,QR_ON_DELIVERY',
    };
    const offer = {
      id: 'off-1',
      storeId: 'store-1',
      productId: 'p1',
      price: 100,
      salePrice: 80,
      isFlashSale: true,
      flashSaleEnd: new Date('2026-11-05T00:00:00Z'),
      stock: 5,
      isActive: true,
      product: { title: 'Producto A', images: '["https://img/a.jpg"]' },
      store,
    };
    const base = {
      customerName: 'Pedro Gómez',
      customerPhone: '+591 70011223',
      customerAddress: 'Calle 1',
      customerLat: -17.77,
      customerLng: -63.19,
      items: [{ productOfferId: 'off-1', quantity: 2 }],
    };

    beforeEach(() => {
      jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      mockPrisma.productOffer = { findMany: jest.fn().mockResolvedValue([offer]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
      mockPrisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(mockPrisma));
      mockPrisma.order.create.mockImplementation((args) => Promise.resolve(args.data));
    });
    afterEach(() => jest.useRealTimers());

    it('cobra el precio de la oferta vigente, suma el envío cotizado y separa la comisión', async () => {
      const result: any = await service.create({ ...base, deliveryAt: '2026-11-02T16:00:00.000Z' });

      expect(result.subtotal).toBe(160); // 2 × Bs 80, not the client's numbers
      expect(result.shippingFee).toBe(15);
      expect(result.totalAmount).toBe(175);
      expect(result.platformCommission).toBe(8);
      expect(result.vendorEarnings).toBe(152);
      expect(result.status).toBe('SCHEDULED');
      expect(result.deliveryWindow).toBe('12:00 - 13:00');
      expect(mockPrisma.productOffer.updateMany).toHaveBeenCalledWith({
        where: { id: 'off-1', stock: { gte: 2 } },
        data: { stock: { decrement: 2 } },
      });
      expect(mockDspService.dispatchOrder).not.toHaveBeenCalled();
    });

    it('no vende la última unidad dos veces: si otro comprador la tomó, el pedido falla', async () => {
      mockPrisma.productOffer.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.create({ ...base, deliveryAt: '2026-11-02T16:00:00.000Z' })).rejects.toThrow('Alguien acaba de comprar');
    });

    it('rechaza horarios que la tienda no ofrece', async () => {
      // Saturday, outside the store's delivery days.
      await expect(service.create({ ...base, deliveryAt: '2026-11-07T14:00:00.000Z' })).rejects.toThrow('horario');
      // Starts in 30 minutes: too soon to pack.
      await expect(service.create({ ...base, deliveryAt: '2026-11-02T14:30:00.000Z' })).rejects.toThrow('horario');
    });

    it('rechaza pedidos que superan el stock', async () => {
      await expect(
        service.create({ ...base, items: [{ productOfferId: 'off-1', quantity: 9 }], deliveryAt: '2026-11-02T16:00:00.000Z' }),
      ).rejects.toThrow('Solo quedan 5');
    });
  });

  describe('dispatchDueOrders', () => {
    it('pide el repartidor solo cuando la ventana está por empezar', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        { id: 'o1', orderNumber: 'VT-1', storeId: 'store-1', customerName: 'Ana', customerPhone: '+591 70000000', customerAddress: 'Calle 2', customerLat: 0, customerLng: 0, totalAmount: 50, paymentMethod: 'CASH_ON_DELIVERY' },
      ]);
      mockPrisma.store.findUnique.mockResolvedValue({ id: 'store-1', name: 'ModaBol', address: 'Av. 1', latitude: 1, longitude: 2 });
      mockPrisma.order.update.mockResolvedValue({});

      const now = new Date('2026-11-02T15:45:00Z');
      await service.dispatchDueOrders(now);

      expect(mockPrisma.order.findMany.mock.calls[0][0].where.deliveryAt.lte).toEqual(new Date('2026-11-02T16:05:00Z'));
      expect(mockDspService.dispatchOrder).toHaveBeenCalledTimes(1);
      expect(mockPrisma.order.update.mock.calls[0][0].data.status).toBe('DSP_DISPATCHED');
    });
  });

  describe('updateStatus & Webhook (TC-ORD-002 & TC-DSP-005)', () => {
    const inTransit = {
      id: 'ord-1',
      orderNumber: 'VT-123-456',
      status: 'IN_TRANSIT',
      vendorEarnings: 190,
      storeId: 'store-1',
      items: [{ storeId: 'store-1', productOfferId: 'off-1', quantity: 2, variant: null }],
    };

    beforeEach(() => {
      mockPrisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(mockPrisma));
      mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.order.update.mockImplementation((args) => Promise.resolve({ id: 'ord-1', status: args.data.status ?? 'DELIVERED' }));
      mockPrisma.productOffer = {
        findUnique: jest.fn().mockResolvedValue({ id: 'off-1', variants: null }),
        update: jest.fn(),
      };
    });

    it('al entregar acredita la ganancia una sola vez, con incremento atómico', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(inTransit);
      await service.updateStatus('ord-1', 'DELIVERED');
      expect(mockPrisma.order.updateMany).toHaveBeenCalledWith({ where: { id: 'ord-1', status: 'IN_TRANSIT' }, data: { status: 'DELIVERED' } });
      expect(mockPrisma.store.update).toHaveBeenCalledWith({
        where: { id: 'store-1' },
        data: { walletBalance: { increment: 190 }, salesCount: { increment: 1 } },
      });
    });

    it('un pedido entregado ya no cambia (no se puede volver a acreditar)', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({ ...inTransit, status: 'DELIVERED' });
      await expect(service.updateStatus('ord-1', 'IN_TRANSIT')).rejects.toThrow('ya fue entregado');
      expect(mockPrisma.store.update).not.toHaveBeenCalled();
    });

    it('si otro proceso cambió el pedido entre medio, no acredita nada', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(inTransit);
      mockPrisma.order.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.updateStatus('ord-1', 'DELIVERED')).rejects.toThrow('cambió');
      expect(mockPrisma.store.update).not.toHaveBeenCalled();
    });

    it('al cancelar devuelve las unidades al stock', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({ ...inTransit, status: 'SCHEDULED' });
      await service.updateStatus('ord-1', 'CANCELLED');
      expect(mockPrisma.productOffer.update).toHaveBeenCalledWith({ where: { id: 'off-1' }, data: { stock: { increment: 2 } } });
    });

    it('procesa el webhook real de OpenDSP (data.merchant_reference) y guarda al repartidor', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(inTransit);
      const res = await service.handleDspWebhook({
        event: 'order.delivered',
        timestamp: '2026-11-02T16:30:00Z',
        data: { order_id: 'dsp_1', merchant_reference: 'VT-123-456', status: 'DELIVERED', driver: { name: 'Ana Ríos', phone: '+591 70000001' } },
      });
      expect(res).toEqual({ ok: true });
      expect(mockPrisma.order.updateMany).toHaveBeenCalledWith({ where: { id: 'ord-1', status: 'IN_TRANSIT' }, data: { status: 'DELIVERED' } });
      expect(mockPrisma.order.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: { dspDriverName: 'Ana Ríos', dspDriverPhone: '+591 70000001' } }),
      );
    });

    it('un evento atrasado no hace retroceder el pedido', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({ ...inTransit, status: 'DELIVERED' });
      await service.handleDspWebhook({ event: 'order.assigned', data: { merchant_reference: 'VT-123-456' } });
      expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
    });
  });
});
