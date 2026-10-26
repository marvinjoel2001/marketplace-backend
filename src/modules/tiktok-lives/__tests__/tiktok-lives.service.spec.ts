import { BadRequestException } from '@nestjs/common';
import { TikTokLivesService } from '../tiktok-lives.service';
import { EcommerceClassifier } from '../ecommerce-classifier.service';
import { TikTokLivesController } from '../tiktok-lives.controller';
import { TikTokLiveCache } from '../tiktok-live-cache.service';
import { ActiveLive } from '../tiktok-lives.types';

describe('TikTokLivesService/API', () => {
  const config: any = {
    country: 'BO',
    enabled: false,
    regionTerms: ['bolivia', 'scz'],
    adminKey: 'a'.repeat(32),
  };
  let prisma: any;
  let cache: any;
  let service: TikTokLivesService;
  const row = () => ({
    username: 'tienda',
    roomId: '7450012345678901234',
    title: 'Ropa Bolivia',
    viewerCount: 22,
    avatarUrl: null,
    coverImageUrl: null,
    tags: '["Bolivia"]',
    category: 'Ropa',
    isSelling: true,
    countryCode: 'BO',
    geoEvidence: 'keyword:bolivia',
    source: 'discovery',
    storeId: null,
    status: 'ACTIVE',
    verifiedAt: new Date(),
  });
  beforeEach(() => {
    prisma = {
      tikTokLive: {
        findMany: jest.fn().mockResolvedValue([row()]),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn(),
      },
      tikTokAccount: { findUnique: jest.fn(), upsert: jest.fn() },
      store: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    cache = {
      read: jest.fn().mockResolvedValue(null),
      version: jest.fn().mockResolvedValue('1'),
      write: jest.fn(),
      invalidate: jest.fn(),
      backend: 'memory',
    };
    service = new TikTokLivesService(
      prisma,
      new EcommerceClassifier(config),
      cache,
      config,
    );
  });
  it('serializa JSON limpio, incluye evidencia y pagina el catálogo verificado', async () => {
    const response = await service.active({ category: 'ropa', limit: '1' });
    expect(response.data[0]).toMatchObject({
      room_id: row().roomId,
      live_id: row().roomId,
      is_selling: true,
      tags: ['Bolivia'],
    });
    expect(response.pagination).toEqual({
      page: 1,
      limit: 1,
      total: 1,
      total_pages: 1,
    });
    expect(cache.write).toHaveBeenCalledWith(response.data, '1');
  });
  it('elimina datos vencidos incluso dentro de una instantánea Redis vigente', async () => {
    const data = (await service.active({})).data;
    cache.read.mockResolvedValue([
      { ...data[0], verified_at: new Date(Date.now() - 61000).toISOString() },
    ]);
    expect((await service.active({})).data).toEqual([]);
  });
  it.each([
    { page: '0' },
    { limit: '101' },
    { page: '1e2' },
    { category: 'cualquiera' },
    { category: ['Ropa', 'Hogar'] },
  ])('rechaza filtros inválidos %p', async (query) => {
    await expect(service.active(query as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it('no altera la sala nueva al recibir un evento tardío de la anterior', async () => {
    prisma.tikTokLive.findUnique.mockResolvedValue({
      ...row(),
      roomId: '2222222222',
    });
    await service.markEnded('tienda', '1111111111');
    expect(prisma.tikTokLive.updateMany).not.toHaveBeenCalled();
  });
  it('no publica un live sin indicios regionales', async () => {
    prisma.tikTokLive.findUnique.mockResolvedValue(null);
    await service.saveVerified({
      username: 'tienda',
      roomId: row().roomId,
      title: 'Remate ropa',
      tags: [],
      viewerCount: 1,
    });
    expect(prisma.tikTokLive.upsert).not.toHaveBeenCalled();
  });
  it('guarda ventas geolocalizadas y usa el tiempo real de verificación', async () => {
    await service.saveVerified({
      username: 'tienda',
      roomId: row().roomId,
      title: 'Remate ropa Bolivia',
      tags: [],
      viewerCount: 12,
    });
    expect(prisma.tikTokLive.upsert.mock.calls[0][0].update).toMatchObject({
      category: 'Ropa',
      status: 'ACTIVE',
      verifiedAt: expect.any(Date),
    });
    expect(cache.invalidate).toHaveBeenCalled();
  });
  it('el registro solo admite usernames, tiendas existentes y cuentas sin otro propietario', async () => {
    await expect(
      service.register('s1', 'https://tiktok.com/@a'),
    ).rejects.toThrow(BadRequestException);
    prisma.store.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE' });
    prisma.tikTokAccount.findUnique.mockResolvedValue({ storeId: 's2' });
    await expect(service.register('s1', '@tienda')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('protege el registro de cuentas sin exponer la clave administrativa', () => {
    const controller = new TikTokLivesController(service, config);
    expect(() => controller.register('s1', 'tienda', 'wrong')).toThrow(
      'Credencial administrativa inválida',
    );
    expect(() =>
      new TikTokLivesController(service, {
        ...config,
        adminKey: '',
      } as any).register('s1', 'tienda'),
    ).toThrow('Configura TIKTOK_ADMIN_KEY');
  });
});

describe('memory cache and snapshot invalidation', () => {
  let cache: TikTokLiveCache;
  beforeEach(() => {
    cache = new TikTokLiveCache({} as any);
  });
  it('vence a los 60 segundos y no revive un snapshot invalidado', async () => {
    jest.useFakeTimers();
    const version = await cache.version();
    await cache.write([] as ActiveLive[], version);
    expect(await cache.read()).toEqual([]);
    jest.advanceTimersByTime(60001);
    expect(await cache.read()).toBeNull();
    await cache.invalidate();
    await cache.write([], version);
    expect(await cache.read()).toBeNull();
    jest.useRealTimers();
  });
  it('impide ejecutar simultáneamente dos trabajos con el mismo lease', async () => {
    let release: () => void;
    const first = cache.withLease(
      'stores',
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const second = jest.fn();
    await cache.withLease('stores', second);
    expect(second).not.toHaveBeenCalled();
    release();
    await first;
    await cache.withLease('stores', second);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('TikTokLivesService.updateViewers', () => {
  it('actualiza espectadores sin invalidar la instantánea en caché', async () => {
    const prisma: any = {
      tikTokLive: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const cache: any = { invalidate: jest.fn() };
    const config: any = { country: 'BO', regionTerms: [] };
    const service = new TikTokLivesService(
      prisma,
      new EcommerceClassifier(config),
      cache,
      config,
    );
    await service.updateViewers('tienda', '7450012345678901234', '1,2K');
    expect(prisma.tikTokLive.updateMany).toHaveBeenCalledWith({
      where: {
        username: 'tienda',
        roomId: '7450012345678901234',
        status: 'ACTIVE',
      },
      data: { viewerCount: 1200 },
    });
    expect(cache.invalidate).not.toHaveBeenCalled();
  });
});
