import { EcommerceClassifier } from '../ecommerce-classifier.service';
import { TikTokLivesConfig } from '../tiktok-lives.config';
import { parseRooms } from '../tiktok-payload.parser';
import {
  LiveCandidate,
  normalizeUsername,
  RetryGate,
  viewerCount,
} from '../tiktok-lives.types';

const config = {
  country: 'BO',
  regionTerms: ['bolivia', 'scz', 'santa cruz'],
} as TikTokLivesConfig;
const live = (title: string, tags: string[] = []): LiveCandidate => ({
  username: 'tienda.sc',
  title,
  tags,
  viewerCount: 0,
});

describe('EcommerceClassifier', () => {
  const classifier = new EcommerceClassifier(config);
  it('detecta ventas, acentos, hashtags y categoría', () => {
    expect(
      classifier.classify(
        live('¡OFERTAS de Electrónica! Envíos', ['#Bolivia']),
      ),
    ).toMatchObject({
      isSelling: true,
      category: 'Electrónica',
      geoEvidence: 'keyword:bolivia',
    });
  });
  it('no convierte una ubicación en señal de venta', () => {
    expect(classifier.classify(live('Música en Bolivia'))).toMatchObject({
      isSelling: false,
    });
  });
  it('evita coincidencias parciales como venta dentro de aventura', () => {
    expect(
      classifier.classify({ ...live('Aventura en Europa, Bolivia'), username: 'viajero' }),
    ).toMatchObject({ isSelling: false });
  });
  it('no presume ubicación por idioma ni por configuración del navegador', () => {
    expect(classifier.classify(live('Remate de ropa'))).toMatchObject({
      isSelling: true,
      category: 'Ropa',
      geoEvidence: null,
    });
  });
  it('detecta ventas en el nombre y descripción aunque el directo tenga título genérico', () => {
    expect(classifier.classify({
      ...live('Holis'), nickname: 'AURA COSMÉTICOS', bio: 'Envíos Bolivia',
    })).toMatchObject({ isSelling: true, category: 'Belleza', listable: true });
    expect(classifier.classify({ ...live('Hola'), nickname: 'DJ local', bio: 'Música' }).isSelling).toBe(false);
  });
  it('reconoce nombres comerciales escritos con letras Unicode decorativas', () => {
    expect(classifier.classify({ ...live('Hola'), nickname: '𝗥𝗢𝗣𝗔 🇧🇴' })).toMatchObject({ isSelling: true, listable: true });
  });
  it('rechaza un país explícitamente distinto aunque el título diga Bolivia', () => {
    expect(
      classifier.classify({ ...live('Ropa Bolivia'), countryCode: 'PE' }, true)
        .geoEvidence,
    ).toBeNull();
  });
  it('acepta una tienda local registrada como evidencia diferenciada', () => {
    expect(classifier.classify(live('Remate'), true).geoEvidence).toBe(
      'registered_store',
    );
  });
  it('lista ventas sin indicio regional salvo que la región sea obligatoria', () => {
    expect(classifier.classify(live('Remate de ropa')).listable).toBe(true);
    const strict = new EcommerceClassifier({
      ...config,
      requireRegion: true,
    } as TikTokLivesConfig);
    expect(strict.classify(live('Remate de ropa')).listable).toBe(false);
    expect(strict.classify(live('Remate de ropa SCZ')).listable).toBe(true);
  });
  it('nunca lista un país explícitamente distinto ni un live sin venta', () => {
    expect(
      classifier.classify({ ...live('Remate de ropa'), countryCode: 'PE' })
        .listable,
    ).toBe(false);
    expect(classifier.classify(live('Música en Bolivia')).listable).toBe(
      false,
    );
  });
  it('reconoce bandera y sufijo local sin atribuirlos a geolocalización verificada', () => {
    const strict = new EcommerceClassifier({ ...config, requireRegion: true } as TikTokLivesConfig);
    expect(strict.classify({ ...live('Ropa en oferta'), nickname: 'Tienda 🇧🇴' })).toMatchObject({
      listable: true, geoEvidence: 'keyword:🇧🇴',
    });
    expect(strict.classify({ ...live('Ropa en oferta'), username: 'mi_tienda.bo' })).toMatchObject({
      listable: true, geoEvidence: 'username:bo',
    });
    expect(strict.classify({ ...live('Ropa en oferta'), username: 'mi_tienda.bo', countryCode: 'PE' }).listable).toBe(false);
  });
});

describe('TikTok payload parser', () => {
  it('extrae la sala de API-live con roomId en data.user sin tratar perfiles como lives', () => {
    const user = { uniqueId: 'Tienda', roomId: '7450012345678901234' };
    expect(parseRooms({ data: { user } })).toEqual([]);
    expect(parseRooms({ data: {
      user,
      liveRoom: { status: 2, title: 'Ropa Bolivia', liveRoomStats: { userCount: 35 } },
    } })[0]).toMatchObject({
      username: 'tienda', roomId: user.roomId, title: 'Ropa Bolivia', viewerCount: 35,
    });
    expect(parseRooms({ data: { user, liveRoom: { status: 4 } } })).toEqual([]);
  });
  it('lee la estructura HTML del connector 2.5 sin perder IDs de 64 bits', () => {
    const rooms = parseRooms({
      user: {
        uniqueId: 'Tienda.SC',
        avatarThumb: 'https://img.example/avatar.jpg',
      },
      liveRoom: {
        roomId: '7450012345678901234',
        status: 2,
        title: 'Ropa SCZ',
        userCount: 12,
        coverUrl: 'https://img.example/cover.jpg',
      },
    });
    expect(rooms[0]).toMatchObject({
      username: 'tienda.sc',
      roomId: '7450012345678901234',
      viewerCount: 12,
      title: 'Ropa SCZ',
    });
  });
  it('lee tarjetas de respuestas webcast, filtra salas terminadas y perfiles sueltos', () => {
    const room = {
      id_str: '7450012345678901234',
      status: 2,
      title: 'Ofertas Bolivia',
      user_count: '1,2K',
      owner: { display_id: 'tienda' },
    };
    expect(
      parseRooms({
        data: [
          { room },
          { room: { ...room, status: 4 } },
          { uniqueId: 'not_live' },
        ],
      }),
    ).toHaveLength(1);
    expect(parseRooms({ data: [{ room }] })[0].viewerCount).toBe(1200);
  });
  it('rechaza IDs numéricos que ya perdieron precisión y URLs inseguras', () => {
    expect(
      parseRooms({ id: 7450012345678901234, owner: { uniqueId: 'tienda' } }),
    ).toEqual([]);
    expect(
      parseRooms({
        id_str: '12345678',
        owner: { uniqueId: 'tienda', avatar: 'javascript:alert(1)' },
      })[0].avatarUrl,
    ).toBeUndefined();
  });
  it('extrae URLs de previsualización de stream_url (API) y streamData (HTML)', () => {
    const [api] = parseRooms({
      id_str: '7450012345678901234',
      owner: { display_id: 'tienda' },
      stream_url: {
        hls_pull_url: 'https://pull-hls.tiktokcdn.com/stage/a.m3u8',
        flv_pull_url: {
          FULL_HD1: 'https://pull-flv.tiktokcdn.com/stage/a_or4.flv',
          SD1: 'https://pull-flv.tiktokcdn.com/stage/a_sd.flv',
        },
      },
    });
    expect(api).toMatchObject({
      streamHlsUrl: 'https://pull-hls.tiktokcdn.com/stage/a.m3u8',
      streamFlvUrl: 'https://pull-flv.tiktokcdn.com/stage/a_sd.flv',
    });
    const [html] = parseRooms({
      user: { uniqueId: 'tienda' },
      liveRoom: {
        roomId: '7450012345678901234',
        status: 2,
        streamData: {
          pull_data: {
            stream_data: JSON.stringify({
              data: {
                origin: { main: { flv: 'https://cdn.example/or.flv' } },
                sd: {
                  main: {
                    flv: 'https://cdn.example/sd.flv',
                    hls: 'https://cdn.example/sd.m3u8',
                  },
                },
              },
            }),
          },
        },
      },
    });
    expect(html).toMatchObject({
      streamHlsUrl: 'https://cdn.example/sd.m3u8',
      streamFlvUrl: 'https://cdn.example/sd.flv',
    });
  });
  it('prefiere la calidad SD de stream_data aunque stream_url solo traiga HD', () => {
    const [room] = parseRooms({
      id_str: '7450012345678901234',
      owner: { display_id: 'tienda' },
      stream_url: {
        hls_pull_url: 'https://pull-hls.tiktokcdn.com/stage/a_hd.m3u8',
        flv_pull_url: { HD1: 'https://pull-flv.tiktokcdn.com/stage/a_hd.flv' },
        live_core_sdk_data: {
          pull_data: {
            stream_data: JSON.stringify({
              data: {
                hd: { main: { flv: 'https://pull-flv.tiktokcdn.com/stage/a_hd.flv' } },
                sd: {
                  main: {
                    flv: 'https://pull-flv.tiktokcdn.com/stage/a_sd.flv',
                    hls: 'https://pull-hls.tiktokcdn.com/stage/a_sd.m3u8',
                  },
                },
              },
            }),
          },
        },
      },
    });
    expect(room).toMatchObject({
      streamFlvUrl: 'https://pull-flv.tiktokcdn.com/stage/a_sd.flv',
      streamHlsUrl: 'https://pull-hls.tiktokcdn.com/stage/a_sd.m3u8',
    });
  });
  it('omite streams inseguros o ausentes sin romper la sala', () => {
    const [room] = parseRooms({
      id_str: '7450012345678901234',
      owner: { display_id: 'tienda' },
      stream_url: { hls_pull_url: 'http://insecure/a.m3u8' },
      streamData: { pull_data: { stream_data: '{malformed' } },
    });
    expect(room.username).toBe('tienda');
    expect(room).not.toHaveProperty('streamHlsUrl');
    expect(room).not.toHaveProperty('streamFlvUrl');
  });
  it('no falla con una respuesta vacía o un reto HTML', () => {
    expect(parseRooms('<html>CAPTCHA</html>')).toEqual([]);
    expect(parseRooms(null)).toEqual([]);
  });
});

describe('validation and backoff', () => {
  it.each([
    'https://evil.test/@user',
    '../etc',
    'x?redirect=y',
    'bad user',
    'a'.repeat(25),
  ])('rechaza username %s', (input) => {
    expect(normalizeUsername(input)).toBeNull();
  });
  it('normaliza @username y viewers locales', () => {
    expect(normalizeUsername(' @Mi.Tienda ')).toBe('mi.tienda');
    expect(viewerCount('1.234')).toBe(1234);
    expect(viewerCount('2,5K')).toBe(2500);
    expect(viewerCount('2M')).toBe(2000000);
    expect(viewerCount('-1')).toBe(0);
  });
  it('espacia intentos, limita el backoff y se recupera después de éxito', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const gate = new RetryGate();
    expect(gate.fail('captcha', 1000)).toBe(30000);
    expect(gate.ready('captcha', 2000)).toBe(false);
    expect(gate.fail('captcha', 32000)).toBe(60000);
    for (let i = 0; i < 10; i++)
      expect(gate.fail('captcha', 32000)).toBeLessThanOrEqual(900000);
    gate.success('captcha');
    expect(gate.ready('captcha', 32000)).toBe(true);
    jest.restoreAllMocks();
  });
});
