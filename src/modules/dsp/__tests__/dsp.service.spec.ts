import { Test, TestingModule } from '@nestjs/testing';
import { DspService } from '../dsp.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SettingsService, DEFAULT_SHIPPING } from '../../settings/settings.service';

describe('DspService', () => {
  let service: DspService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DspService,
        { provide: PrismaService, useValue: { store: { findUnique: jest.fn().mockResolvedValue(null) } } },
        { provide: SettingsService, useValue: { getShipping: jest.fn().mockResolvedValue(DEFAULT_SHIPPING) } },
      ],
    }).compile();

    service = module.get<DspService>(DspService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getQuote', () => {
    it('should calculate shipping price with base fare and distance', async () => {
      const quote = await service.getQuote({
        pickupLat: -17.7685,
        pickupLng: -63.1952,
        dropoffLat: -17.785,
        dropoffLng: -63.18,
      });

      expect(quote).toBeDefined();
      expect(quote.price).toBeGreaterThan(0);
      expect(quote.distanceKm).toBeGreaterThan(0);
      expect(quote.estimatedMinutes).toBeGreaterThanOrEqual(15);
      expect(quote.quoteId).toBeDefined();
    });
  });

  describe('dispatchOrder', () => {
    const order = {
      quoteId: 'dsp_q_123',
      orderNumber: 'VT-894120-412',
      customerName: 'Juan Pérez',
      customerPhone: '+591 77012345',
      customerAddress: 'Av. San Martín #450',
      customerLat: -17.785,
      customerLng: -63.18,
      storeName: 'TechPlus Bolivia',
      storeAddress: 'Equipetrol Local 12',
      storeLat: -17.7685,
      storeLng: -63.1952,
      totalAmount: 189,
      paymentMethod: 'CASH_ON_DELIVERY',
    };
    afterEach(() => jest.restoreAllMocks());

    it('devuelve el pedido que crea OpenDSP', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: 'dsp_ord_1', trackingToken: 'trk_1', status: 'SEARCHING_DRIVER' }), { status: 201 }),
      );
      const dispatch = await service.dispatchOrder(order);
      expect(dispatch.dspOrderId).toBe('dsp_ord_1');
      expect(dispatch.trackingToken).toBe('trk_1');
      expect(dispatch.driver).toBeUndefined();
    });

    it('si OpenDSP no responde, falla en vez de inventar un repartidor', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
      await expect(service.dispatchOrder(order)).rejects.toThrow('fetch failed');
    });

    it('si OpenDSP rechaza el pedido, falla con el motivo', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(new Response('quote expired', { status: 400 }));
      await expect(service.dispatchOrder(order)).rejects.toThrow('OpenDSP HTTP 400');
    });
  });
});
