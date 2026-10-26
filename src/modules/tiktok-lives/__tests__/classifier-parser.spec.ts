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
      classifier.classify(live('Aventura en Europa, Bolivia')),
    ).toMatchObject({ isSelling: false });
  });
  it('no presume ubicación por idioma ni por configuración del navegador', () => {
    expect(classifier.classify(live('Remate de ropa'))).toMatchObject({
      isSelling: true,
      category: 'Ropa',
      geoEvidence: null,
    });
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
});

describe('TikTok payload parser', () => {
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
