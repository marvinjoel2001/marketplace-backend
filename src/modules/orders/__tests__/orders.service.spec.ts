import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from '../orders.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { DspService } from '../../dsp/dsp.service';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: PrismaService;
  let dspService: DspService;

  const mockPrisma = {
    order: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
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
});
