import { LiveFeedService } from '../live-feed.service';
import type { FeedHandlers } from '../tiktok-connector.service';

describe('LiveFeedService', () => {
  let handlers: FeedHandlers;
  let close: jest.Mock;
  let connector: { openFeed: jest.Mock };
  let service: LiveFeedService;

  beforeEach(() => {
    close = jest.fn().mockResolvedValue(undefined);
    connector = {
      openFeed: jest.fn((_u: string, _r: string, on: FeedHandlers) => {
        handlers = on;
        return Promise.resolve(close);
      }),
    };
    service = new LiveFeedService(connector as never);
  });

  const flush = () => new Promise((r) => setImmediate(r));

  it('guarda comentarios, likes, espectadores, fijados y productos reales de la sala', async () => {
    expect(service.snapshot('tienda', '123').status).toBe('connecting');
    await flush();

    handlers.chat({ common: { msgId: 'm1', createTime: '1000' }, content: 'Precio del 34?', user: { nickname: 'Ana', displayId: 'ana_bo', avatarThumb: { urlList: ['https://p16.tiktokcdn.com/a.jpg'] } } });
    handlers.chat({ common: { msgId: 'm2' }, content: '   ', user: {} });
    handlers.like({ total: 1500 });
    handlers.like({ total: 1400 }); // out-of-order events never lower the total
    handlers.viewers({ total: 87 });
    handlers.pin({ pinId: 'p1', chatMessage: { content: 'Poleras a Bs 59', user: { nickname: 'La tienda' } } });
    handlers.product({ shopData: { title: 'Polera', priceString: 'Bs 59', imageUrl: 'http://inseguro/img.jpg' } });

    const snap = service.snapshot('tienda', '123');
    expect(snap.status).toBe('live');
    expect(snap.comments).toEqual([
      { id: 'm1', name: 'Ana', handle: 'ana_bo', avatar: 'https://p16.tiktokcdn.com/a.jpg', text: 'Precio del 34?', at: 1000 },
    ]);
    expect(snap.likes).toBe(1500);
    expect(snap.viewers).toBe(87);
    expect(snap.pins[0].text).toBe('Poleras a Bs 59');
    expect(snap.products[0]).toEqual({ title: 'Polera', price: 'Bs 59', image: null, url: null });
    expect(connector.openFeed).toHaveBeenCalledTimes(1);
  });

  it('devuelve solo los comentarios nuevos y cierra salas que nadie mira', async () => {
    service.snapshot('tienda', '123');
    await flush();
    handlers.chat({ common: { msgId: 'a' }, content: 'hola', user: {} });
    handlers.chat({ common: { msgId: 'b' }, content: 'quiero', user: {} });
    expect(service.snapshot('tienda', '123', 'a').comments.map((c) => c.id)).toEqual(['b']);

    service.sweep(Date.now() + 120_000);
    await flush();
    expect(close).toHaveBeenCalled();
  });

  it('marca la sala como no disponible si TikTok rechaza la conexión', async () => {
    connector.openFeed.mockRejectedValueOnce(new Error('blocked'));
    service.snapshot('otra', '9');
    await flush();
    expect(service.snapshot('otra', '9').status).toBe('unavailable');
  });
});
