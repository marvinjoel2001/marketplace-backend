import { StoresService } from '../stores.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('store dashboard summary', () => {
  afterEach(() => jest.useRealTimers());
  it('sums only this store’s lines and uses Bolivia midnight for today', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-29T02:00:00Z')); // Oct 28, 22:00 in Bolivia
    const findMany = jest.fn().mockResolvedValueOnce([
      { createdAt: new Date('2026-10-29T01:00:00Z'), items: [{ subtotal: 59 }, { subtotal: 129 }] },
      { createdAt: new Date('2026-10-28T03:59:00Z'), items: [{ subtotal: 80 }] },
    ]).mockResolvedValueOnce([]);
    const prisma = {
      store: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }) },
      order: { findMany },
      productOffer: { count: jest.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(1) },
    };
    const service = new StoresService(prisma as unknown as PrismaService);
    const summary = await service.getSummary('s1');
    expect(summary.today).toEqual({ total: 188, count: 1 });
    expect(summary.week).toEqual({ total: 268, count: 2 });
    expect(summary.products).toBe(5);
    expect(findMany.mock.calls[0][0].select.items.where).toEqual({ storeId: 's1' });
    expect(findMany.mock.calls[0][0].where.status).toEqual({ not: 'CANCELLED' });
  });
});
