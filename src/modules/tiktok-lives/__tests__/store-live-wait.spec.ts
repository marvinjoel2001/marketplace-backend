import { BadRequestException } from '@nestjs/common';
import { TikTokLivesService } from '../tiktok-lives.service';
import { EcommerceClassifier } from '../ecommerce-classifier.service';
import { TikTokLivesWorker } from '../tiktok-lives.worker';

const config: any = { country: 'BO', enabled: true, regionTerms: [], verifyConcurrency: 2 };

describe('vincular el TikTok que la tienda escribió', () => {
  function setup(store: unknown, owner: unknown = null) {
    const prisma: any = {
      store: { findUnique: jest.fn().mockResolvedValue(store), updateMany: jest.fn() },
      tikTokAccount: { findUnique: jest.fn().mockResolvedValue(owner), create: jest.fn() },
    };
    const cache: any = { invalidate: jest.fn() };
    const service = new TikTokLivesService(prisma, new EcommerceClassifier(config), cache, config);
    return { service, prisma, cache };
  }

  it('añade el usuario de la tienda a sus cuentas sin quitar las otras', async () => {
    const { service, prisma, cache } = setup({ id: 's1', status: 'ACTIVE', tiktokUsername: 'Max_Pena2001' });
    await expect(service.linkStoreAccount('s1')).resolves.toBe('max_pena2001');
    expect(prisma.tikTokAccount.create).toHaveBeenCalledWith({
      data: { storeId: 's1', username: 'max_pena2001', countryCode: 'BO' },
    });
    expect(cache.invalidate).toHaveBeenCalled();
  });

  it('no toca nada si esa cuenta ya es de la tienda', async () => {
    const { service, prisma } = setup({ id: 's1', status: 'ACTIVE', tiktokUsername: 'tienda' }, { storeId: 's1', username: 'tienda' });
    await expect(service.linkStoreAccount('s1')).resolves.toBe('tienda');
    expect(prisma.tikTokAccount.create).not.toHaveBeenCalled();
  });

  it('rechaza una cuenta que ya usa otra tienda', async () => {
    const { service, prisma } = setup({ id: 's1', status: 'ACTIVE', tiktokUsername: 'ajena' }, { storeId: 's2', username: 'ajena' });
    await expect(service.linkStoreAccount('s1')).rejects.toThrow(BadRequestException);
    expect(prisma.tikTokAccount.create).not.toHaveBeenCalled();
  });

  it('sin usuario de TikTok no vincula nada', async () => {
    const { service, prisma } = setup({ id: 's1', status: 'ACTIVE', tiktokUsername: null });
    await expect(service.linkStoreAccount('s1')).resolves.toBeNull();
    expect(prisma.tikTokAccount.create).not.toHaveBeenCalled();
  });

  it('la tienda sigue en vivo mientras otra de sus cuentas transmite', async () => {
    const { service, prisma } = setup(null);
    prisma.tikTokLive = { count: jest.fn().mockResolvedValue(1) };
    await service.refreshStoreLive('s1');
    expect(prisma.store.updateMany).toHaveBeenCalledWith({ where: { id: 's1' }, data: { isLiveNow: true } });
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

  it('al abrir la venta busca el live en todas las cuentas de esa tienda', async () => {
    const store = { id: 's1', status: 'ACTIVE' };
    const prisma = {
      tikTokAccount: {
        findMany: jest.fn().mockResolvedValue([
          { username: 'tienda', store },
          { username: 'tienda_ofertas', store },
        ]),
      },
    };
    const { w, verify } = worker(prisma);
    w.checkStore('s1');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(prisma.tikTokAccount.findMany).toHaveBeenCalledWith({ where: { storeId: 's1' }, include: { store: true } });
    expect(verify.mock.calls.map((c) => c[0])).toEqual(['tienda', 'tienda_ofertas']);
  });

  it('no hace nada con el revisor apagado', async () => {
    const prisma = { tikTokAccount: { findMany: jest.fn() } };
    const { w } = worker(prisma, { enabled: false });
    await w.waitingStores();
    w.checkStore('s1');
    expect(prisma.tikTokAccount.findMany).not.toHaveBeenCalled();
  });
});
