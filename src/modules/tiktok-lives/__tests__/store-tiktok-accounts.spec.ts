import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MAX_ACCOUNTS_PER_STORE, StoreTikTokAccountsService, usernameFromText } from '../store-tiktok-accounts.service';

describe('leer el usuario de TikTok de lo que pega el vendedor', () => {
  it.each([
    ['max_pena2001', 'max_pena2001'],
    ['@Max_Pena2001', 'max_pena2001'],
    ['  @@tienda.shifu ', 'tienda.shifu'],
    ['https://www.tiktok.com/@max_pena2001', 'max_pena2001'],
    ['https://www.tiktok.com/@max_pena2001/live?lang=es', 'max_pena2001'],
    ['https://www.tiktok.com/@tienda.shifu?_t=ZM-8abc&_r=1', 'tienda.shifu'],
  ])('%s → %s', (input, expected) => expect(usernameFromText(input)).toBe(expected));

  it.each(['', 'mi tienda', 'https://vm.tiktok.com/ZMabc123/', 'á'.repeat(5), 'a'.repeat(30)])(
    'rechaza %s', (input) => expect(usernameFromText(input)).toBeNull(),
  );
});

describe('cuentas de TikTok de una tienda', () => {
  function setup(accounts: { username: string; storeId: string; createdAt?: Date; countryCode?: string }[] = []) {
    const rows = accounts.map((a) => ({ countryCode: 'BO', createdAt: new Date('2026-11-01'), ...a }));
    const prisma: any = {
      store: { findUnique: jest.fn().mockResolvedValue({ id: 's1', status: 'ACTIVE' }), update: jest.fn() },
      tikTokAccount: {
        findMany: jest.fn(() => Promise.resolve(rows.filter((r) => r.storeId === 's1'))),
        findUnique: jest.fn(({ where }) => Promise.resolve(rows.find((r) => r.username === where.username) ?? null)),
        findFirst: jest.fn(() => Promise.resolve(rows.find((r) => r.storeId === 's1') ?? null)),
        count: jest.fn(() => Promise.resolve(rows.filter((r) => r.storeId === 's1').length)),
        create: jest.fn(({ data }) => { const row = { createdAt: new Date(), ...data }; rows.push(row); return Promise.resolve(row); }),
        delete: jest.fn(({ where }) => { rows.splice(rows.findIndex((r) => r.username === where.username), 1); return Promise.resolve(); }),
      },
      tikTokLive: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), updateMany: jest.fn() },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const cache: any = { invalidate: jest.fn() };
    const service = new StoreTikTokAccountsService(prisma, cache, { country: 'BO' } as any);
    return { service, prisma, rows };
  }

  it('añade otra cuenta y conserva la primera como principal', async () => {
    const { service, prisma } = setup([{ username: 'tienda', storeId: 's1' }]);
    const list = await service.add('s1', 'https://www.tiktok.com/@tienda_ofertas');
    expect(list.map((a) => a.username)).toEqual(['tienda', 'tienda_ofertas']);
    expect(prisma.store.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tiktokUsername: 'tienda' }) }),
    );
  });

  it('no deja usar la cuenta de otra tienda', async () => {
    const { service, prisma } = setup([{ username: 'ajena', storeId: 's2' }]);
    await expect(service.add('s1', '@ajena')).rejects.toThrow('otra tienda');
    expect(prisma.tikTokAccount.create).not.toHaveBeenCalled();
  });

  it(`permite hasta ${MAX_ACCOUNTS_PER_STORE} cuentas`, async () => {
    const { service } = setup(Array.from({ length: MAX_ACCOUNTS_PER_STORE }, (_, i) => ({ username: `t${i}`, storeId: 's1' })));
    await expect(service.add('s1', 'otra')).rejects.toThrow(BadRequestException);
  });

  it('explica cómo encontrar el usuario si lo que pegó no sirve', async () => {
    const { service } = setup();
    await expect(service.add('s1', 'mi tienda de ropa')).rejects.toThrow('empieza con @');
  });

  it('corrige un usuario mal escrito sin cambiar su lugar y cierra su live viejo', async () => {
    const created = new Date('2026-10-01');
    const { service, prisma } = setup([
      { username: 'tienda_shfu', storeId: 's1', createdAt: created },
      { username: 'tienda_b', storeId: 's1' },
    ]);
    await service.rename('s1', 'tienda_shfu', '@tienda_shifu');
    expect(prisma.tikTokAccount.create).toHaveBeenCalledWith({
      data: { storeId: 's1', username: 'tienda_shifu', countryCode: 'BO', createdAt: created },
    });
    expect(prisma.tikTokLive.updateMany).toHaveBeenCalledWith({ where: { username: 'tienda_shfu', storeId: 's1' }, data: { status: 'ENDED' } });
  });

  it('solo edita o quita cuentas de la propia tienda', async () => {
    const { service } = setup([{ username: 'ajena', storeId: 's2' }]);
    await expect(service.rename('s1', 'ajena', 'nueva')).rejects.toThrow(NotFoundException);
    await expect(service.remove('s1', 'ajena')).rejects.toThrow(NotFoundException);
  });

  it('al quitar la principal, la siguiente pasa a ser la principal', async () => {
    const { service, prisma } = setup([
      { username: 'tienda', storeId: 's1' },
      { username: 'tienda_b', storeId: 's1' },
    ]);
    const list = await service.remove('s1', 'tienda');
    expect(list.map((a) => a.username)).toEqual(['tienda_b']);
    expect(prisma.store.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tiktokUsername: 'tienda_b' }) }),
    );
  });

  it('marca cuál cuenta está en vivo', async () => {
    const { service, prisma } = setup([
      { username: 'tienda', storeId: 's1' },
      { username: 'tienda_b', storeId: 's1' },
    ]);
    prisma.tikTokLive.findMany.mockResolvedValue([{ username: 'tienda_b', viewerCount: 40 }]);
    const list = await service.list('s1');
    expect(list.map((a) => [a.username, a.live, a.viewerCount])).toEqual([['tienda', false, 0], ['tienda_b', true, 40]]);
  });
});
