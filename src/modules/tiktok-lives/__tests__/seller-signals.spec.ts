import { EcommerceClassifier } from '../ecommerce-classifier.service';
import { isBuyerComment, judgeCaptions, judgeChat } from '../seller-signals';
import { SellerSignalsService } from '../seller-signals.service';
import { TikTokLivesConfig } from '../tiktok-lives.config';
import { LiveCandidate } from '../tiktok-lives.types';
import { parseProfileVideos } from '../tiktok-payload.parser';

const config = {
  country: 'BO',
  regionTerms: ['bolivia', 'scz', 'santa cruz'],
} as TikTokLivesConfig;
const classifier = new EcommerceClassifier(config);
const live = (title: string, extra: Partial<LiveCandidate> = {}): LiveCandidate => ({
  username: 'maria.perez',
  roomId: '7450012345678901234',
  title,
  tags: [],
  viewerCount: 10,
  ...extra,
});

describe('palabras de venta ampliadas en el título', () => {
  it.each([
    'Gran REMATE hoy',
    'Ofertas de fin de mes',
    'Todo baratito',
    'Liquidando todo',
    'Nuevos ingresos 🔥',
    'Precios bajos',
    '2x1 en poleras',
    'Comenta mío',
    'Lo de hoy 🛍️',
  ])('"%s" cuenta como venta', (title) => {
    expect(classifier.classify(live(title)).isSelling).toBe(true);
  });
  it('un live común sigue sin contar', () => {
    expect(classifier.classify(live('Buenas noches, charlemos')).isSelling).toBe(false);
  });
});

describe('comentarios del chat', () => {
  it.each(['MÍOOO', 'mio', 'precio?', 'cuánto sale la negra', 'talla M porfa', 'hacen envíos a Cocha?', '12 mío', 'separame el azul'])(
    '"%s" es de un comprador',
    (text) => expect(isBuyerComment(text)).toBe(true),
  );
  it.each(['hola desde La Paz', 'jajaja', 'que bonita', 'saludos'])('"%s" no lo es', (text) =>
    expect(isBuyerComment(text)).toBe(false),
  );

  it('varios compradores distintos marcan venta; uno solo no', () => {
    const comments = [
      { user: 'a', text: 'precio?' },
      { user: 'b', text: 'mío' },
      { user: 'c', text: 'talla L' },
    ];
    expect(judgeChat({ comments, products: 0, pins: [] }, 'tienda')).toMatchObject({ selling: true, hits: 3, buyers: 3 });
    const spam = [1, 2, 3, 4].map(() => ({ user: 'a', text: 'precio' }));
    expect(judgeChat({ comments: spam, products: 0, pins: [] }, 'tienda').selling).toBe(false);
  });
  it('productos de TikTok Shop, mensajes fijados o la anfitriona con precios bastan', () => {
    expect(judgeChat({ comments: [], products: 1, pins: [] }, 'tienda').selling).toBe(true);
    expect(judgeChat({ comments: [], products: 0, pins: ['Pedidos al 71234567'] }, 'tienda').selling).toBe(true);
    expect(judgeChat({ comments: [{ user: 'tienda', text: 'Blusas a 45 Bs' }], products: 0, pins: [] }, 'tienda').selling).toBe(true);
    expect(judgeChat({ comments: [{ user: 'tienda', text: 'hola amigos' }], products: 0, pins: [] }, 'tienda').selling).toBe(false);
  });
});

describe('videos del perfil', () => {
  it('detecta ventas repetidas en los videos', () => {
    expect(judgeCaptions(['Nuevos modelos disponibles #ropa', 'Remate de chamarras a 80 Bs', 'mi perrito'])).toMatchObject({
      selling: true,
    });
    expect(judgeCaptions(['Un día en la playa', 'Remate!', 'Bailando']).selling).toBe(false);
    expect(judgeCaptions([]).selling).toBe(false);
  });
  it('lee los subtítulos del autor desde item_list e ignora videos de otros', () => {
    const payload = {
      itemList: [
        { id: '1', desc: 'Llegaron vestidos', author: { uniqueId: 'maria.perez' }, textExtra: [{ hashtagName: 'ventas' }] },
        { id: '2', desc: 'Repost ajeno', author: { uniqueId: 'otra' } },
      ],
      userInfo: { user: { uniqueId: 'maria.perez', signature: 'Envíos a todo Bolivia' } },
    };
    expect(parseProfileVideos(payload, 'maria.perez')).toEqual({
      captions: ['Llegaron vestidos #ventas'],
      bio: 'Envíos a todo Bolivia',
    });
  });
});

describe('clasificación con señales', () => {
  const signals = (s: Partial<{ videoSelling: boolean; chatSelling: boolean; chatRoomId: string | null }>) => ({
    videoSelling: false,
    chatSelling: false,
    chatRoomId: null,
    ...s,
  });
  it('el chat de esta misma sala cuenta como venta del live', () => {
    const result = classifier.classify(live('Hola'), false, signals({ chatSelling: true, chatRoomId: '7450012345678901234' }));
    expect(result).toMatchObject({ isSelling: true, salesEvidence: 'chat' });
  });
  it('los videos de la cuenta cuentan, salvo en gaming o música', () => {
    expect(classifier.classify(live('Hola'), false, signals({ videoSelling: true }))).toMatchObject({
      isSelling: true,
      salesEvidence: 'videos',
    });
    expect(classifier.classify(live('Free Fire con amigos'), false, signals({ videoSelling: true })).isSelling).toBe(false);
  });
});

describe('SellerSignalsService', () => {
  function setup(found: { captions: string[] } | undefined, chat: { user: string; text: string }[] | null) {
    const stored = new Map<string, any>();
    const lives: any = {
      signalChecks: jest.fn().mockResolvedValue(new Map()),
      signalsFor: jest.fn(async () => stored),
      recordVideoSignal: jest.fn(async (username: string, selling: boolean) => {
        stored.set(username, { ...stored.get(username), videoSelling: selling, chatSelling: false, chatRoomId: null });
      }),
      recordChatSignal: jest.fn(async (username: string, roomId: string, selling: boolean) => {
        stored.set(username, { videoSelling: false, ...stored.get(username), chatSelling: selling, chatRoomId: roomId });
      }),
    };
    const discovery: any = {
      scanProfiles: jest.fn().mockResolvedValue(new Map(found ? [['maria.perez', found]] : [])),
    };
    const connector: any = {
      openFeed: jest.fn(async (_u: string, _r: string, on: any) => {
        if (!chat) throw new Error('sin socket');
        setTimeout(() => {
          chat.forEach((c) => on.chat({ content: c.text, user: { uniqueId: c.user } }));
          on.ended(); // The sample ends with the stream instead of waiting the full window.
        }, 0);
        return async () => undefined;
      }),
    };
    const service = new SellerSignalsService(
      {
        profileChecksPerCycle: 5,
        chatSamplesPerCycle: 5,
        chatSampleSeconds: 15,
        chatMinBuyerComments: 3,
        maxConnections: 10,
        country: 'BO',
        regionTerms: [],
      } as any,
      lives,
      discovery,
      connector,
      classifier,
    );
    return { service, lives, discovery, connector };
  }

  it('promueve un live cuyo chat pide precios y lo saca de la cola', async () => {
    const { service, lives } = setup({ captions: [] }, [
      { user: 'a', text: 'precio?' },
      { user: 'b', text: 'mío' },
      { user: 'c', text: 'cuánto?' },
    ]);
    service.enqueue([live('Hola a todos')]);
    const found = await service.inspect();
    expect(found.map((f) => f.live.username)).toEqual(['maria.perez']);
    expect(lives.recordChatSignal).toHaveBeenCalledWith('maria.perez', '7450012345678901234', true, 3);
    expect(service.pending).toBe(0);
  });

  it('promueve por los videos aunque el chat no se pueda abrir', async () => {
    const { service } = setup({ captions: ['Remate de zapatos', 'Ofertas en vivo hoy'] }, null);
    service.enqueue([live('Hola')]);
    expect((await service.inspect()).length).toBe(1);
  });

  it('deja fuera un live sin señales y no lo vuelve a revisar', async () => {
    const { service, lives } = setup({ captions: ['Mi día'] }, [{ user: 'a', text: 'hola' }]);
    service.enqueue([live('Hola')]);
    expect(await service.inspect()).toEqual([]);
    expect(lives.recordVideoSignal).toHaveBeenCalledWith('maria.perez', false, []);
    expect(service.pending).toBe(0);
  });
});
