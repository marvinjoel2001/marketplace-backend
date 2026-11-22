import { BadRequestException } from '@nestjs/common';
import { TikTokLivesService } from '../tiktok-lives.service';
import { EcommerceClassifier } from '../ecommerce-classifier.service';
import { TikTokLivesWorker } from '../tiktok-lives.worker';

const config: any = { country: 'BO', enabled: true, regionTerms: [], verifyConcurrency: 2 };

describe('vincular el TikTok que la tienda escribió', () => {
  function setup(store: unknown, accounts: Record<string, unknown> = {}) {
    const prisma: any = {
      store: { findUnique: jest.fn().mockResolvedValue(store) },
      tikTokAccount: {
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(where.storeId ? accounts.byStore ?? null : accounts.byUsername ?? null),
        ),
        upsert: jest.fn(),
      },
      tikTokLive: { updateMany: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const cache: any = { invalidate: jest.fn() };
    const service = new TikTokLivesService(prisma, new EcommerceClassifier(config), cache, config);
    return { service, prisma, cache };
  }

  it('vincula el usuario de la tienda para que el revisor busque su live', async () => {
    const { service, prisma, cache } = setup({ id: 's1', status: 'ACTIVE', tiktokUsername: 'Max_Pena2001' });
    await expect(service.linkStoreAccount('s1')).resolves.toBe('max_pena2001');
    expect(prisma.tikTokAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: 's1' },
        create: { storeId: 's1', username: 'max_pena2001', countryCode: 'BO' },
      }),
    );
    expect(prisma.tikTokLive.updateMany).toHaveBeenCalledWith({
      where: { storeId: 's1', username: { not: 'max_pena2001' } },
      data: { status: 'ENDED' },
    });
    expect(cache.invalidate).toHaveBeenCalled();
  });

  it('no toca nada si ya estaba vinculado con el mismo usuario', async () => {
    const { service, prisma } = setup(
      { id: 's1', status: 'ACTIVE', tiktokUsername: 'tienda' },
      { byStore: { storeId: 's1', username: 'tienda' } },
    );
    await expect(service.linkStoreAccount('s1')).resolves.toBe('tienda');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('cambia el vínculo cuando la tienda cambió de usuario', async () => {
    const { service, prisma } = setup(
      { id: 's1', status: 'ACTIVE', tiktokUsername: 'nuevo' },
      { byStore: { storeId: 's1', username: 'viejo' } },
    );
    await service.linkStoreAccount('s1');
    expect(prisma.tikTokAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { username: 'nuevo', countryCode: 'BO' } }),
    );
  });

  it('rechaza una cuenta que ya usa otra tienda', async () => {
    const { service, prisma } = setup(
      { id: 's1', status: 'ACTIVE', tiktokUsername: 'ajena' },
      { byUsername: { storeId: 's2', username: 'ajena' } },
    );
    await expect(service.linkStoreAccount('s1')).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('sin usuario de TikTok no vincula nada', async () => {
    const { service, prisma } = setup({ id: 's1', status: 'ACTIVE', tiktokUsername: null });
    await expect(service.linkStoreAccount('s1')).resolves.toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('tiendas esperando su live', () => {
  function worker(prisma: any, overrides: Record<string, unknown> = {}) {
    const cache = {
      withLease: jest.fn((_n: string, task: (owned: () => boolean) => Promise<void>) => task(() => true)),
    };
    const w = new TikTokLivesWorker(
      prisma, {} as any, {} as any, {} as any, {} as any, cache as any,
      { ...config, ...overrides } as any, {} as any,
    );
    const verify = jest.spyOn(w as any, 'verify').mockResolvedValue(undefined);
    return { w, verify };
  }

  it('cada 30s revisa solo tiendas con venta abierta y sin live reciente, sin esperar la pausa global', async () => {
    const store = { id: 's1', status: 'ACTIVE', category: 'Ropa', address: '' };
    const prisma = {
      tikTokAccount: { findMany: jest.fn().mockResolvedValue([{ username: 'max_pena2001', store }]) },
    };
    const { w, verify } = worker(prisma);
    await w.waitingStores();
    const where = prisma.tikTokAccount.findMany.mock.calls[0][0].where.store;
    expect(where.liveStreams).toEqual({ some: { status: 'LIVE' } });
    expect(where.discoveredLives.none.status).toBe('ACTIVE');
    expect(verify).toHaveBeenCalledWith('max_pena2001', undefined, store, expect.any(Function), true);
  });

  it('al abrir la venta busca el live de esa tienda enseguida', async () => {
    const store = { id: 's1', status: 'ACTIVE' };
    const prisma = {
      tikTokAccount: { findUnique: jest.fn().mockResolvedValue({ username: 'tienda', store }) },
    };
    const { w, verify } = worker(prisma);
    w.checkStore('s1');
    await new Promise((r) => setImmediate(r));
    expect(verify).toHaveBeenCalledWith('tienda', undefined, store, undefined, true);
  });

  it('no hace nada con el revisor apagado', async () => {
    const prisma = { tikTokAccount: { findMany: jest.fn(), findUnique: jest.fn() } };
    const { w } = worker(prisma, { enabled: false });
    await w.waitingStores();
    w.checkStore('s1');
    expect(prisma.tikTokAccount.findMany).not.toHaveBeenCalled();
    expect(prisma.tikTokAccount.findUnique).not.toHaveBeenCalled();
  });
});
