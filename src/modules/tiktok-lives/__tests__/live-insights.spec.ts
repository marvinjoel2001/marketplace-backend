import { EcommerceClassifier } from '../ecommerce-classifier.service';
import {
  detectCity,
  extractPrice,
  extractWhatsApp,
  salesScore,
} from '../live-insights';
import { LiveCandidate } from '../tiktok-lives.types';
import { TikTokLivesConfig } from '../tiktok-lives.config';

const live = (
  title: string,
  extra: Partial<LiveCandidate> = {},
): LiveCandidate => ({
  username: 'vendedora',
  title,
  tags: [],
  viewerCount: 0,
  ...extra,
});

describe('WhatsApp en títulos', () => {
  it('detecta celulares bolivianos con o sin prefijo y separadores', () => {
    expect(extractWhatsApp('SCZ 75059927 🎃')).toBe('59175059927');
    expect(extractWhatsApp('76736570 ventita de canguros😘')).toBe(
      '59176736570',
    );
    expect(extractWhatsApp('mio+precio 62726511')).toBe('59162726511');
    expect(extractWhatsApp('pedidos +591 7123-4567')).toBe('59171234567');
  });
  it('ignora fijos, montos y números más largos', () => {
    expect(extractWhatsApp('llama al 3345678')).toBeNull();
    expect(extractWhatsApp('remate 3x140bs')).toBeNull();
    expect(extractWhatsApp('id 750599271234')).toBeNull();
  });
});

describe('precio en títulos', () => {
  it.each([
    ['Por hoy vestidos a 45 👗🌷', 'Bs 45'],
    ['Holi... Hoy todo 10bs', 'Bs 10'],
    ['3x140bs🥰', '3 x Bs 140'],
    ['todos desde 5 bs', 'desde Bs 5'],
    ['fajas a cuotas desde 20 bs', 'desde Bs 20'],
    ['VENTA DE TUPPERWARE BOLSA 300BS', 'Bs 300'],
    ['Blusas Bs. 35', 'Bs 35'],
  ])('%s → %s', (title, price) => {
    expect(extractPrice(title)).toBe(price);
  });
  it('no confunde horas, cuotas, teléfonos ni montos chicos', () => {
    expect(extractPrice('abrimos a 10 am')).toBeNull();
    expect(extractPrice('fajas a cuotas')).toBeNull();
    expect(extractPrice('SCZ 75059927')).toBeNull();
    expect(extractPrice('de 1 a 2')).toBeNull();
  });
});

describe('ciudad', () => {
  it('reconoce abreviaturas, ciudades y usernames', () => {
    expect(detectCity(['SCZ 75059927'])).toBe('Santa Cruz');
    expect(detectCity(['carteras La Paz 🌻'])).toBe('La Paz');
    expect(detectCity(['ventas', 'tienda_cbba'])).toBe('Cochabamba');
    expect(detectCity(['HOY GRAN LIQUIDACIÓN ORURO'])).toBe('Oruro');
    expect(detectCity(['keyword:bolivia'])).toBeNull();
  });
});

describe('puntaje de venta', () => {
  it('prioriza la señal del título, precio y WhatsApp', () => {
    const strong = salesScore({
      title: 'Remate de ropa a 45',
      tags: [],
      category: 'Ropa',
      price: 'Bs 45',
      whatsapp: '59171234567',
    });
    const weak = salesScore({
      title: 'Bienvenidos 🤗',
      tags: [],
      category: 'Otros',
      price: null,
      whatsapp: null,
    });
    expect(strong).toBe(7);
    expect(weak).toBe(0);
  });
});

describe('clasificador ampliado', () => {
  const classifier = new EcommerceClassifier({
    country: 'BO',
    regionTerms: ['bolivia', 'la paz'],
  } as TikTokLivesConfig);
  it.each([
    ['Falditas 🍒✨ venta', 'Ropa'],
    ['carteras La Paz 🌻💕 venta', 'Accesorios'],
    ['VENTA DE TUPPERWARE BOLSA 300BS', 'Hogar'],
    ['Juguetes americanos y anime', 'Juguetes'],
    ['Termos y ollas en oferta 💖', 'Hogar'],
  ])('%s → %s', (title, category) => {
    expect(classifier.classify(live(title)).category).toBe(category);
  });
  it('elige la categoría con más coincidencias, no la primera de la lista', () => {
    expect(
      classifier.classify(live('remate de carteras, bolsos y aretes, una blusa'))
        .category,
    ).toBe('Accesorios');
  });
  it('descarta gaming o música si la venta solo está en el nombre de la cuenta', () => {
    expect(
      classifier.classify(
        live('', { username: 'gamerbo7491', nickname: 'Gamer Store' }),
      ).isSelling,
    ).toBe(false);
    expect(
      classifier.classify(live('Música en vivo', { nickname: 'La Tienda' }))
        .isSelling,
    ).toBe(false);
  });
  it('mantiene la venta si el título del live la anuncia aunque sea gamer', () => {
    expect(
      classifier.classify(
        live('Venta de consolas', { username: 'gamerbo7491' }),
      ).isSelling,
    ).toBe(true);
  });
  it('sigue aceptando cuentas comerciales por nombre o bio', () => {
    expect(
      classifier.classify(live('Bienvenidos 🤗', { nickname: 'Reusa Store' }))
        .isSelling,
    ).toBe(true);
  });
});

describe('vendedores reales que antes se perdían (región obligatoria)', () => {
  const strict = new EcommerceClassifier({
    country: 'BO',
    regionTerms: ['bolivia', 'santa cruz'],
    requireRegion: true,
  } as TikTokLivesConfig);
  it('usa el celular boliviano de la bio como evidencia regional', () => {
    const result = strict.classify(
      live('hermosos calzados', {
        nickname: 'calzados Mia',
        bio: 'venta de calzados brazileros\npedidos 75169210',
      }),
    );
    expect(result).toMatchObject({ listable: true, geoEvidence: 'phone:bo' });
  });
  it('reconoce el catálogo wa.me/591 y la liquidación con precio', () => {
    expect(
      strict.classify(
        live('Liquidación 5bs', {
          bio: 'catálogo en WhatsApp: https://wa.me/c/59161245678',
        }),
      ).listable,
    ).toBe(true);
  });
  it('un celular en el título es una venta aunque no diga "venta"', () => {
    expect(strict.classify(live('78006766📲'))).toMatchObject({
      isSelling: true,
      listable: true,
    });
  });
  it('detecta jerga de venta pero exige Bolivia si la región es obligatoria', () => {
    const result = strict.classify(live('Chompas y crop top liqui 😊'));
    expect(result.isSelling).toBe(true);
    expect(result.listable).toBe(false);
  });
  it('no confunde servicios, juegos ni frases comunes con ventas', () => {
    expect(
      strict.classify(
        live('', { bio: 'CONTRATOS: El PATRON YACUIBEÑO 75162213' }),
      ).isSelling,
    ).toBe(false);
    expect(strict.classify(live('FNCS SOLOS GRAND FINALS | EU')).isSelling).toBe(
      false,
    );
    expect(strict.classify(live('mi hermano mayor juega')).isSelling).toBe(
      false,
    );
  });
});

describe('tiendas reconocidas por el nombre de la cuenta', () => {
  const strict = new EcommerceClassifier({
    country: 'BO',
    regionTerms: ['bolivia'],
    requireRegion: true,
  } as TikTokLivesConfig);
  const anyRegion = new EcommerceClassifier({
    country: 'BO',
    regionTerms: [],
  } as TikTokLivesConfig);
  it.each([
    ['importadora_ramos_', 'Otros'],
    ['fardospormayorkoreanos', 'Ropa'],
    ['nezztienda', 'Otros'],
    ['jugueteria.gissel', 'Juguetes'],
    ['fabellacosmeticosxmayor', 'Belleza'],
    ['clarelcarteras', 'Accesorios'],
    ['essence_closet_', 'Ropa'],
    ['yokitoys1', 'Juguetes'],
    ['muebleriadelproveedor', 'Hogar'],
  ])('@%s vende (%s) aunque el live no tenga título', (username, category) => {
    expect(
      anyRegion.classify(live('Bienvenidos', { username })),
    ).toMatchObject({ isSelling: true, category });
  });
  it.each([
    'mini_luci1',
    'chicogamerrff',
    'europa_viajes',
    'lolesports',
    'ventanas_y_puertas',
    'modalidad_x',
  ])('@%s no es tienda', (username) => {
    expect(anyRegion.classify(live('Hola', { username })).isSelling).toBe(false);
  });
  it('reconoce Bolivia o ciudades pegadas en el usuario', () => {
    for (const username of [
      'fardosboliviaofficial',
      'fardoscaliforniaoruro',
      'mini.kids.scz',
      'bc.store.bo',
      'moda.bol',
    ])
      expect(strict.classify(live('Bienvenidos', { username }))).toMatchObject({
        listable: true,
        geoEvidence: 'username:bo',
      });
  });
});
