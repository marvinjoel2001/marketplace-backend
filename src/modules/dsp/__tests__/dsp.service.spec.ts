import { Test, TestingModule } from '@nestjs/testing';
import { DspService } from '../dsp.service';

describe('DspService', () => {
  let service: DspService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DspService],
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
    it('should dispatch order and return courier assignment', async () => {
      const dispatch = await service.dispatchOrder({
        quoteId: 'dsp_q_123',
        orderNumber: 'CY-894120-412',
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
        paymentMethod: 'QR_SIMPLE',
      });

      expect(dispatch).toBeDefined();
      expect(dispatch.dspOrderId).toBeDefined();
      expect(dispatch.trackingToken).toBeDefined();
      expect(dispatch.driver).toBeDefined();
      expect(dispatch.driver?.name).toBe('Carlos Mendoza');
    });
  });
});
