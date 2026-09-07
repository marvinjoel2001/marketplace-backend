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

  describe('findAll', () => {
    it('should return recent orders', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        { id: 'o1', orderNumber: 'CY-123456-111' },
      ]);

      const result = await service.findAll(5);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
    });
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

    it('should return fallback demo order when order is not in DB', async () => {
      mockPrisma.order.findFirst.mockResolvedValue(null);

      const result = await service.findByIdOrNumber('CY-894120-412');
      expect(result).toBeDefined();
      expect(result.orderNumber).toBe('CY-894120-412');
      expect(result.dspDriverName).toBe('Carlos Mendoza');
    });
  });

  describe('create (TC-ORD-001 & TC-MONEY-001)', () => {
    it('debería calcular el split financiero (5% comisión, 95% tienda)', async () => {
      mockPrisma.order.create.mockImplementation((args) => Promise.resolve(args.data));

      const result: any = await service.create({
        customerName: 'Pedro Gómez',
        customerPhone: '+591 70011223',
        items: [
          {
            productTitle: 'Producto A',
            quantity: 2,
            unitPrice: 100, // Subtotal = 200
            storeId: 'store-1',
          },
        ],
        shippingFee: 15,
      });

      expect(result.subtotal).toBe(200);
      expect(result.totalAmount).toBe(215);
      expect(result.platformCommission).toBe(10); // 5% de 200
      expect(result.vendorEarnings).toBe(190); // 95% de 200
    });
  });

  describe('updateStatus & Webhook (TC-ORD-002 & TC-DSP-005)', () => {
    it('debería actualizar estado a DELIVERED y acreditar saldo a la tienda', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({
        id: 'ord-1',
        orderNumber: 'CY-123-456',
        status: 'IN_TRANSIT',
        vendorEarnings: 190,
        items: [{ storeId: 'store-1' }],
      });
      mockPrisma.order.update.mockResolvedValue({
        id: 'ord-1',
        status: 'DELIVERED',
      });
      mockPrisma.store.findUnique.mockResolvedValue({
        id: 'store-1',
        walletBalance: 100,
        salesCount: 5,
      });
      mockPrisma.store.update.mockResolvedValue({
        id: 'store-1',
        walletBalance: 290,
        salesCount: 6,
      });

      const res = await service.updateStatus('ord-1', 'DELIVERED');
      expect(res.status).toBe('DELIVERED');
      expect(mockPrisma.store.update).toHaveBeenCalledWith({
        where: { id: 'store-1' },
        data: {
          walletBalance: 290,
          salesCount: 6,
        },
      });
    });

    it('debería procesar webhook de OpenDSP y actualizar orden', async () => {
      mockPrisma.order.findFirst.mockResolvedValue({
        id: 'ord-1',
        orderNumber: 'CY-123-456',
        status: 'IN_TRANSIT',
        vendorEarnings: 95,
        items: [{ storeId: 'store-1' }],
      });
      mockPrisma.order.update.mockResolvedValue({
        id: 'ord-1',
        status: 'DELIVERED',
      });
      mockPrisma.store.findUnique.mockResolvedValue({
        id: 'store-1',
        walletBalance: 0,
        salesCount: 0,
      });
      mockPrisma.store.update.mockResolvedValue({});

      const res = await service.handleDspWebhook({
        event: 'order.delivered',
        externalOrderId: 'CY-123-456',
        status: 'DELIVERED',
      });

      expect(res.status).toBe('DELIVERED');
    });
  });
});

