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
  let apiRoute: jest.Mock;
  let roomRoute: jest.Mock;
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
    apiRoute = jest.fn().mockResolvedValue({ message: 'unavailable' });
    roomRoute = jest.fn();
    (service as any).sdk = Promise.resolve({
      ...sdk,
      RouteConfig: { fetchRoomInfoFromHtml: route, fetchRoomInfoFromApiLive: apiRoute, fetchRoomInfo: roomRoute },
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
    expect(apiRoute).not.toHaveBeenCalled();
  });
  it('actualiza una sala conocida por webcast sin repetir las consultas de perfil', async () => {
    roomRoute.mockResolvedValue({ data: {
      id_str: live.roomId, status: 2, title: live.title, user_count: 12,
      owner: { display_id: 'tienda' },
    } });
    expect((await service.probe('tienda', live.roomId)).live).toMatchObject(live);
    expect(roomRoute).toHaveBeenCalledWith({ webClient: connection.webClient, roomId: live.roomId });
    expect(route).not.toHaveBeenCalled();
    expect(apiRoute).not.toHaveBeenCalled();
  });
  it('no inventa fin de transmisión ante un bloqueo de la ruta webcast', async () => {
    roomRoute.mockRejectedValue(new Error('403'));
    await expect(service.probe('tienda', live.roomId)).rejects.toThrow('403');
    expect(route).not.toHaveBeenCalled();
  });
  it.each([undefined, null, '', '  ', {}])('recurre al perfil público cuando webcast devuelve un cuerpo vacío: %p', async (empty) => {
    roomRoute.mockResolvedValue(empty);
    route.mockResolvedValue({
      user: { uniqueId: 'tienda' },
      liveRoom: { roomId: live.roomId, status: 2, title: live.title },
    });
    expect((await service.probe('tienda', live.roomId)).live).toMatchObject({
      username: 'tienda', roomId: live.roomId,
    });
    expect(route).toHaveBeenCalledTimes(1);
    expect(apiRoute).not.toHaveBeenCalled();
  });
  it('no renueva estado si tampoco puede verificar el perfil de respaldo', async () => {
    roomRoute.mockResolvedValue(undefined);
    route.mockRejectedValue(new Error('403'));
    apiRoute.mockResolvedValue({ message: 'unavailable' });
    await expect(service.probe('tienda', live.roomId)).rejects.toThrow('sin estado verificable');
    expect(lives.markEnded).not.toHaveBeenCalled();
  });
  it('retira salas terminadas y rechaza otra cuenta o sala desde webcast', async () => {
    roomRoute.mockResolvedValue({ data: { id_str: live.roomId, status: 4, owner: { display_id: 'tienda' } } });
    expect(await service.probe('tienda', live.roomId)).toEqual({ live: null });
    roomRoute.mockResolvedValue({ data: { id_str: live.roomId, status: 2, owner: { display_id: 'otra' } } });
    await expect(service.probe('tienda', live.roomId)).rejects.toThrow('sin estado verificable');
    roomRoute.mockResolvedValue({ data: { id_str: '9999999999', status: 2, owner: { display_id: 'tienda' } } });
    await expect(service.probe('tienda', live.roomId)).rejects.toThrow('sala distinta');
  });
  it('lee roomId en el usuario hermano como lo entrega TikTok actualmente', async () => {
    route.mockResolvedValue({
      user: { uniqueId: 'Tienda', roomId: live.roomId },
      liveRoom: { status: 2, title: live.title, userCount: 12 },
    });
    expect((await service.probe('@Tienda')).live).toMatchObject(live);
    expect(apiRoute).not.toHaveBeenCalled();
  });
  it.each(['error', 'incomplete'])('recurre a API-live si HTML falla: %s', async (mode) => {
    if (mode === 'error') route.mockRejectedValue(new Error('Missing SIGI_STATE'));
    else route.mockResolvedValue({ user: { uniqueId: 'tienda' } });
    apiRoute.mockResolvedValue({
      data: {
        user: { uniqueId: 'tienda', roomId: live.roomId },
        liveRoom: { status: 2, title: live.title, liveRoomStats: { userCount: 12 } },
      },
      statusCode: 0,
    });
    expect((await service.probe('tienda')).live).toMatchObject(live);
    expect(connection.connect).not.toHaveBeenCalled();
  });
  it('distingue offline explícito de API-live y rechaza respuestas de otra cuenta', async () => {
    route.mockRejectedValue(new Error('Missing SIGI_STATE'));
    apiRoute.mockResolvedValue({ data: { user: { uniqueId: 'tienda', roomId: '0' } } });
    expect(await service.probe('tienda')).toEqual({ live: null });
    apiRoute.mockResolvedValue({
      data: {
        user: { uniqueId: 'otra', roomId: live.roomId },
        liveRoom: { status: 2 },
      },
    });
    await expect(service.probe('tienda')).rejects.toThrow('sin estado verificable');
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
    apiRoute.mockRejectedValue(new Error('429'));
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
  it('mantiene la sala verificada por HTTP si solo se pierde el WebSocket', async () => {
    await service.watch(live);
    connection.emit('disconnected');
    expect(lives.markEnded).not.toHaveBeenCalled();
    await service.watch(live);
    expect(connection.connect).toHaveBeenCalledTimes(1);
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
    config = {
      enabled: true,
      country: 'BO',
      regionTerms: ['bolivia'],
      verifyConcurrency: 3,
    };
    connector = {
      probe: jest.fn().mockResolvedValue({ live }),
      watch: jest.fn().mockResolvedValue(undefined),
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
  it('inicia exploración y actualización al arrancar, sin esperar al cron', () => {
    const discover = jest.spyOn(worker, 'discover').mockResolvedValue();
    const stores = jest.spyOn(worker, 'registeredStores').mockResolvedValue();
    const refresh = jest.spyOn(worker, 'refreshActive').mockResolvedValue();
    worker.onApplicationBootstrap();
    expect(discover).toHaveBeenCalledTimes(1);
    expect(stores).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('no bloquea verificaciones del lote mientras espera la firma del WebSocket', async () => {
    connector.watch.mockReturnValue(new Promise(() => {}));
    await worker.refreshActive();
    expect(lives.saveVerified).toHaveBeenCalledTimes(1);
    expect(connector.probe).toHaveBeenCalledWith('tienda', live.roomId);
  });
  it('guarda salas vistas en el feed sin otra consulta y deja el filtro regional a saveVerified', async () => {
    config.requireRegion = true;
    const discovery = (worker as any).discovery;
    const sighted = { ...live, title: 'Remate de ropa', tags: [] };
    discovery.discover.mockResolvedValue([sighted]);
    await worker.discover();
    expect(connector.probe).not.toHaveBeenCalled();
    expect(lives.saveVerified).toHaveBeenCalledWith(sighted);
  });
  it('consulta por HTTP los candidatos sin sala y las tiendas registradas vistas en el feed', async () => {
    const discovery = (worker as any).discovery;
    discovery.discover.mockResolvedValue([
      { ...live, username: 'sin_sala', roomId: undefined, title: 'Remate de ropa' },
      { ...live, username: 'registrada', title: 'Remate de ropa' },
    ]);
    prisma.tikTokAccount.findUnique.mockImplementation(async ({ where }: any) =>
      where.username === 'registrada' ? { username: 'registrada', store: null } : null,
    );
    connector.probe.mockImplementation(async (username: string) => ({ live: { ...live, username } }));
    await worker.discover();
    expect(connector.probe.mock.calls.map(([username]) => username).sort()).toEqual(['registrada', 'sin_sala']);
  });
  it('solo re-verifica salas cuya última verificación ya tiene más de 2 minutos', async () => {
    await worker.refreshActive();
    const { where } = prisma.tikTokLive.findMany.mock.calls[0][0];
    expect(where.status).toBe('ACTIVE');
    expect(Date.now() - where.verifiedAt.lt.getTime()).toBeGreaterThanOrEqual(120000);
  });
  it('pausa todas las verificaciones cuando TikTok rechaza muchas seguidas', async () => {
    connector.probe.mockRejectedValue(new Error('403'));
    const verify = (username: string) => (worker as any).verify(username, { ...live, username });
    for (let i = 0; i < 12; i++) await verify(`cuenta_${i}`);
    expect(connector.probe).toHaveBeenCalledTimes(8);
    expect(lives.markEnded).not.toHaveBeenCalled();
  });
  it('alarga la pausa global si TikTok sigue rechazando aunque alguna verificación pase', async () => {
    let now = 100000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const verify = (username: string) => (worker as any).verify(username, { ...live, username });
      const failBurst = async (prefix: string) => {
        connector.probe.mockRejectedValue(new Error('403'));
        for (let i = 0; i < 8; i++) await verify(`${prefix}_${i}`);
      };
      await failBurst('a');
      now += 36000; // first pause: ~30-35s
      connector.probe.mockResolvedValue({ live });
      await verify('suerte');
      await failBurst('b');
      now += 36000;
      expect((worker as any).retry.ready('probes', now)).toBe(false); // second pause doubled
      now += 30000;
      expect((worker as any).retry.ready('probes', now)).toBe(true);
    } finally { clock.mockRestore(); }
  });
  it('no renueva verificaciones ni anuncia fin cuando TikTok bloquea la consulta', async () => {
    connector.probe.mockRejectedValue(new Error('captcha'));
    await worker.refreshActive();
    await worker.refreshActive();
    expect(connector.probe).toHaveBeenCalledTimes(1);
    expect(lives.saveVerified).not.toHaveBeenCalled();
    expect(lives.markEnded).not.toHaveBeenCalled();
  });
  it('limita el lote lento y comienza el siguiente por las cuentas aún no revisadas', async () => {
    let now = 100000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    config.verifyConcurrency = 1;
    prisma.tikTokLive.findMany.mockImplementation(async () => ['a', 'b', 'c', 'd'].map((username) => ({
      ...live, username, tags: '[]', store: null,
    })));
    connector.probe.mockImplementation(async (username: string) => {
      now += 10001;
      return { live: { ...live, username } };
    });
    try {
      await worker.refreshActive();
      expect(connector.probe.mock.calls.map(([username]) => username)).toEqual(['a', 'b']);
      // Work already started is committed even after the batch deadline.
      expect(lives.saveVerified).toHaveBeenCalledTimes(2);
      now += 30000;
      await worker.refreshActive();
      expect(connector.probe.mock.calls.map(([username]) => username)).toEqual(['a', 'b', 'c', 'd']);
    } finally { clock.mockRestore(); }
  });
  it('reintenta una cuenta bloqueada dentro del margen de recuperación', async () => {
    let now = 100000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    connector.probe.mockRejectedValue(new Error('403'));
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        await worker.refreshActive();
        now += 70000;
      }
      expect(connector.probe).toHaveBeenCalledTimes(5);
      expect(lives.saveVerified).not.toHaveBeenCalled();
      expect(lives.markEnded).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
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
