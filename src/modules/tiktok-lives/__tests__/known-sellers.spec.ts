import { TikTokLivesWorker } from '../tiktok-lives.worker';

describe('re-verificación de vendedores conocidos', () => {
  function setup(config: Record<string, unknown>) {
    const prisma = {
      tikTokLive: {
        findMany: jest.fn().mockResolvedValue([
          { username: 'calzados_mia' },
          { username: 'joyeria_paz' },
        ]),
      },
    };
    const cache = {
      withLease: jest.fn((_name: string, task: (owned: () => boolean) => Promise<void>) =>
        task(() => true),
      ),
    };
    const worker = new TikTokLivesWorker(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      cache as any,
      { enabled: true, verifyConcurrency: 2, ...config } as any,
    );
    const verify = jest
      .spyOn(worker as any, 'verify')
      .mockResolvedValue(undefined);
    return { worker, prisma, verify };
  }

  it('revisa en rotación los vendedores terminados, primero los menos recientes', async () => {
    const { worker, prisma, verify } = setup({ recheckPerCycle: 40 });
    await worker.knownSellers();
    expect(prisma.tikTokLive.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'ENDED', storeId: null },
        orderBy: { updatedAt: 'asc' },
        take: 40,
      }),
    );
    expect(verify.mock.calls.map((call) => call[0])).toEqual([
      'calzados_mia',
      'joyeria_paz',
    ]);
  });

  it('no hace nada si está desactivado o el ciclo es 0', async () => {
    for (const config of [{ recheckPerCycle: 0 }, { enabled: false, recheckPerCycle: 40 }]) {
      const { worker, prisma } = setup(config);
      await worker.knownSellers();
      expect(prisma.tikTokLive.findMany).not.toHaveBeenCalled();
    }
  });
});

describe('semillas para la bola de nieve', () => {
  it('rota por los vendedores en vivo y no repite hasta dar la vuelta', async () => {
    const prisma = {
      tikTokLive: {
        findMany: jest.fn().mockResolvedValue(
          ['a', 'b', 'c', 'd', 'e'].map((username) => ({ username })),
        ),
      },
    };
    const worker = new TikTokLivesWorker(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { snowballPerCycle: 2 } as any,
    );
    const seeds = () => (worker as any).seeds();
    expect(await seeds()).toEqual(['a', 'b']);
    expect(await seeds()).toEqual(['c', 'd']);
    expect(await seeds()).toEqual(['e', 'a']);
  });
  it('no busca semillas si está desactivado', async () => {
    const prisma = { tikTokLive: { findMany: jest.fn() } };
    const worker = new TikTokLivesWorker(
      prisma as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { snowballPerCycle: 0 } as any,
    );
    expect(await (worker as any).seeds()).toEqual([]);
    expect(prisma.tikTokLive.findMany).not.toHaveBeenCalled();
  });
});
