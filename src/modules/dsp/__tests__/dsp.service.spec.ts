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
    afterEach(() => jest.restoreAllMocks());

    it('sends the promised window and returns the Core order', async () => {
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'core-1', trackingToken: 'trk-1', status: 'CREATED' }),
      } as any);
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
        paymentMethod: 'CASH_ON_DELIVERY',
        deliveryAt: new Date('2026-11-02T14:00:00.000Z'),
        deliveryWindow: '10:00 - 11:00',
      });

      expect(dispatch).toEqual(expect.objectContaining({ dspOrderId: 'core-1', trackingToken: 'trk-1', status: 'CREATED' }));
      expect(dispatch?.driver).toBeUndefined();
      const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
      expect(body.merchantReference).toBe('CY-894120-412');
      expect(body.packageNotes).toContain('10:00 - 11:00');
      expect(body.packageNotes).toContain('COBRAR EN EFECTIVO');
    });

    describe('compra combinada', () => {
      const order = {
        quoteId: 'dsp_q_123',
        orderNumber: 'VT-1',
        customerName: 'Juan Pérez',
        customerPhone: '+591 77012345',
        customerAddress: 'Av. San Martín #450',
        customerLat: -17.785,
        customerLng: -63.18,
        storeName: 'Tienda A',
        storeAddress: 'Local 12',
        storeLat: -17.7685,
        storeLng: -63.1952,
        totalAmount: 60,
        paymentMethod: 'CASH_ON_DELIVERY',
        batchReference: 'CP-1',
        routeNote: 'RUTA COMBINADA CP-1: 2 pedidos del mismo cliente, van en un solo viaje',
      };
      const accepted = { ok: true, status: 201, json: async () => ({ id: 'core-1', trackingToken: 'trk-1' }) };

      it('manda el número de compra para que OpenDSP junte los pedidos en un viaje', async () => {
        const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(accepted as any);
        await service.dispatchOrder(order);
        const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
        expect(body.batchReference).toBe('CP-1');
        expect(body.packageNotes).toContain('RUTA COMBINADA CP-1');
      });

      it('si OpenDSP es una versión que no conoce los viajes combinados, lo manda como entrega normal', async () => {
        const fetchMock = jest
          .spyOn(global, 'fetch')
          .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'property batchReference should not exist' } as any)
          .mockResolvedValueOnce(accepted as any);
        const dispatch = await service.dispatchOrder(order);
        expect(dispatch?.dspOrderId).toBe('core-1');
        expect(JSON.parse((fetchMock.mock.calls[1][1] as any).body).batchReference).toBeUndefined();
      });
    });

    it('returns null instead of inventing a driver when Core is unreachable', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
      expect(await service.dispatchOrder({
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
        paymentMethod: 'CASH_ON_DELIVERY',
        deliveryAt: new Date('2026-11-02T14:00:00.000Z'),
        deliveryWindow: '10:00 - 11:00',
      })).toBeNull();
    });
  });
});
