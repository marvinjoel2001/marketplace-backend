import { TikTokConnectorService } from '../tiktok-connector.service';
import { TikTokLivesWorker } from '../tiktok-lives.worker';
import { EcommerceClassifier } from '../ecommerce-classifier.service';
import { EventEmitter } from 'node:events';

const live = {
  username: 'tienda',
  roomId: '7450012345678901234',
  title: 'Ropa Bolivia',
  viewerCount: 12,
  tags: [],
};
describe('connector HTTP state and WebSocket lifecycle', () => {
  let service: TikTokConnectorService;
  let route: jest.Mock;
  let connection: any;
  let lives: any;
  const sdk = {
    ControlEvent: { ERROR: 'error', DISCONNECTED: 'disconnected' },
    WebcastEvent: { STREAM_END: 'streamEnd', ROOM_USER: 'roomUser' },
  };
  beforeEach(() => {
    lives = {
      markEnded: jest.fn().mockResolvedValue(undefined),
      updateViewers: jest.fn().mockResolvedValue(undefined),
    };
    service = new TikTokConnectorService({ maxConnections: 1 } as any, lives);
    route = jest.fn();
    (service as any).sdk = Promise.resolve({
      ...sdk,
      RouteConfig: { fetchRoomInfoFromHtml: route },
    });
    connection = Object.assign(new EventEmitter(), {
      webClient: {},
      connect: jest.fn().mockResolvedValue({}),
      disconnect: jest.fn().mockResolvedValue(undefined),
    });
    jest.spyOn(service as any, 'create').mockResolvedValue(connection);
  });
  afterEach(async () => {
    await service.onModuleDestroy();
  });
  it('verifica por HTTP la respuesta real del route HTML de connector 2.5', async () => {
    route.mockResolvedValue({
      user: { uniqueId: 'tienda' },
      liveRoom: { roomId: live.roomId, status: 2, title: live.title },
    });
    expect((await service.probe('tienda')).live).toMatchObject({
      username: 'tienda',
      roomId: live.roomId,
    });
    expect(connection.connect).not.toHaveBeenCalled();
  });
  it('distingue fin explícito de CAPTCHA o estado desconocido', async () => {
    route.mockResolvedValue({
      user: { uniqueId: 'tienda' },
      liveRoom: { status: 4 },
    });
    expect(await service.probe('tienda')).toEqual({ live: null });
    route.mockResolvedValue({ message: 'captcha' });
    await expect(service.probe('tienda')).rejects.toThrow(
      'sin estado verificable',
    );
    route.mockRejectedValue(new Error('429'));
    await expect(service.probe('tienda')).rejects.toThrow('429');
  });
  it('retira salas finalizadas, procesa viewers sin renovar vigencia y cierra sockets', async () => {
    await service.watch(live);
    connection.emit('roomUser', { total: '250' });
    expect(lives.updateViewers).toHaveBeenCalledWith(
      'tienda',
      live.roomId,
      '250',
    );
    connection.emit('streamEnd');
    expect(lives.markEnded).toHaveBeenCalledWith('tienda', live.roomId);
    expect(connection.disconnect).toHaveBeenCalled();
  });
  it('limita sockets y aplica backoff tras fallar connect', async () => {
    connection.connect.mockRejectedValue(new Error('signature unavailable'));
    await service.watch(live);
    await service.watch(live);
    expect(connection.connect).toHaveBeenCalledTimes(1);
    expect(lives.markEnded).not.toHaveBeenCalled();
  });
  it('no confunde desconexión de una sala vieja con la nueva', async () => {
    await service.watch(live);
    await service.unwatch('tienda');
    connection.emit('disconnected');
    expect(lives.markEnded).not.toHaveBeenCalled();
  });
  it('respeta el límite de sockets incluso con intentos concurrentes', async () => {
    await Promise.all(
      ['a', 'b', 'c'].map((username) => service.watch({ ...live, username })),
    );
    expect(connection.connect).toHaveBeenCalledTimes(1);
  });
});

describe('TikTok worker freshness and failure handling', () => {
  let worker: TikTokLivesWorker;
  let connector: any;
  let lives: any;
  let prisma: any;
  let config: any;
  beforeEach(() => {
    config = { enabled: true, country: 'BO', regionTerms: ['bolivia'] };
    connector = {
      probe: jest.fn().mockResolvedValue({ live }),
      watch: jest.fn(),
      unwatch: jest.fn(),
    };
    lives = {
      saveVerified: jest.fn().mockResolvedValue({}),
      markEnded: jest.fn(),
    };
    prisma = {
      tikTokAccount: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      tikTokLive: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...live,
            tags: '["Bolivia"]',
            geoEvidence: 'keyword:bolivia',
            store: null,
          },
        ]),
      },
      store: { updateMany: jest.fn() },
    };
    const cache: any = {
      withLease: jest.fn(async (_key, task) => task(() => true)),
    };
    worker = new TikTokLivesWorker(
      prisma,
      { discover: jest.fn().mockResolvedValue([live]) } as any,
      connector,
      new EcommerceClassifier(config),
      lives,
      cache,
      config,
    );
  });
  it('no ejecuta trabajos de red cuando está deshabilitado', async () => {
    config.enabled = false;
    await worker.discover();
    await worker.registeredStores();
    await worker.refreshActive();
    expect(connector.probe).not.toHaveBeenCalled();
  });
  it('no renueva verificaciones ni anuncia fin cuando TikTok bloquea la consulta', async () => {
    connector.probe.mockRejectedValue(new Error('captcha'));
    await worker.refreshActive();
    await worker.refreshActive();
    expect(connector.probe).toHaveBeenCalledTimes(1);
    expect(lives.saveVerified).not.toHaveBeenCalled();
    expect(lives.markEnded).not.toHaveBeenCalled();
  });
  it('retira una sala cuando HTTP informa fin explícito', async () => {
    connector.probe.mockResolvedValue({ live: null });
    await worker.refreshActive();
    expect(lives.markEnded).toHaveBeenCalledWith('tienda');
    expect(connector.unwatch).toHaveBeenCalledWith('tienda');
  });
  it('preserva tags de la misma sala pero no hereda el título de una sala anterior', async () => {
    connector.probe.mockResolvedValue({
      live: { ...live, title: '', tags: [] },
    });
    await worker.refreshActive();
    expect(lives.saveVerified.mock.calls[0][0]).toMatchObject({
      title: live.title,
      tags: ['Bolivia'],
    });
    connector.probe.mockResolvedValue({
      live: { ...live, roomId: '9999999999999', title: '', tags: [] },
    });
    await worker.refreshActive();
    expect(lives.saveVerified.mock.calls[1][0]).toMatchObject({
      title: '',
      tags: [],
    });
  });
});
