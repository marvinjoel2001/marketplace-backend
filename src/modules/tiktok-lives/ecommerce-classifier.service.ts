import { Injectable } from '@nestjs/common';
import { contains, extractPrice, extractWhatsApp } from './text-signals';
import { TikTokLivesConfig } from './tiktok-lives.config';
import {
  LiveCandidate,
  LiveCategory,
  normalizeText,
} from './tiktok-lives.types';

export const SALES = [
  'ropa',
  'venta',
  'vendo',
  'ventas',
  'remate',
  'prendas',
  'tienda',
  'disponible',
  'precio',
  'precios',
  'envios',
  'oferta',
  'ofertas',
  'showroom',
  'subasta',
  'liquidacion',
  'catalogo',
  'pedido',
  'pedidos',
  'comprar',
  'boutique',
  'importaciones',
  'cosmeticos',
  'maquillaje',
  'accesorios',
  'fardo',
  'fardos',
  'zapatos',
  'calzado',
  'juguetes',
  'perfumes',
  'portabebes',
  'ferreteria',
  'joyas',
  'carteras',
  'bolsos',
  'shop',
  'store',
  'shopping',
  'closet',
  'lenceria',
  'fajas',
  'importadora',
  'importador',
  'liqui',
  'saldos',
  'calzados',
  'compra',
  'compras',
  'compritas',
  'reservas',
  'por mayor',
  'mayorista',
  'mayoristas',
  'delivery',
  'cajita',
  'cajitas',
  'novedades',
  'promo',
  'promocion',
  'promociones',
  'descuento',
  'descuentos',
  'stock',
  'caserita',
  'caseritas',
  'casero',
  'caseros',
  'qr',
  'utensilios',
  'emprendimiento',
  'pidan',
  'disponibles',
];
const CATEGORY_TERMS: [LiveCategory, string[]][] = [
  [
    'Ropa',
    [
      'ropa',
      'prendas',
      'moda',
      'vestido',
      'vestidos',
      'falda',
      'faldas',
      'falditas',
      'blusa',
      'blusas',
      'chompa',
      'chompas',
      'pantalon',
      'pantalones',
      'poleras',
      'polera',
      'jeans',
      'buzos',
      'chamarras',
      'casacas',
      'rompevientos',
      'biker',
      'enterizos',
      'conjuntos',
      'pijamas',
      'lenceria',
      'fajas',
      'fardo',
      'fardos',
      'americana',
      'boutique',
      'closet',
      'outfit',
      'zapatillas',
      'zapatos',
      'calzado',
      'tenis',
      'botas',
      'sandalias',
    ],
  ],
  [
    'Accesorios',
    [
      'accesorios',
      'cartera',
      'carteras',
      'bolso',
      'bolsos',
      'mochilas',
      'canguros',
      'billeteras',
      'joyas',
      'joyeria',
      'bisuteria',
      'relojes',
      'lentes',
      'aretes',
      'collares',
      'pulseras',
    ],
  ],
  [
    'Electrónica',
    [
      'electronica',
      'celular',
      'celulares',
      'iphone',
      'samsung',
      'xiaomi',
      'laptop',
      'tablet',
      'tecnologia',
      'audifonos',
      'parlantes',
      'cargadores',
      'smartwatch',
      'consolas',
    ],
  ],
  [
    'Hogar',
    [
      'hogar',
      'muebles',
      'cocina',
      'decoracion',
      'sabanas',
      'edredones',
      'frazadas',
      'cortinas',
      'electrodomesticos',
      'tupperware',
      'termos',
      'ollas',
      'vajilla',
      'plasticos',
      'ferreteria',
      'herramientas',
      'limpieza',
    ],
  ],
  [
    'Belleza',
    [
      'belleza',
      'maquillaje',
      'cosmeticos',
      'perfume',
      'perfumes',
      'perfumeria',
      'skincare',
      'cremas',
      'labiales',
      'pestanas',
      'pelucas',
      'extensiones',
      'shampoo',
    ],
  ],
  [
    'Juguetes',
    [
      'juguetes',
      'jugueteria',
      'peluches',
      'munecas',
      'anime',
      'figuras',
      'lego',
      'hot wheels',
      'autos de coleccion',
      'coleccionables',
    ],
  ],
];
/**
 * Shop words as they appear glued inside usernames ("importadora_ramos_", "fardospormayorkoreanos",
 * "nezztienda"). Matched as substrings of the username without separators; "chic" is left out
 * because "chica" is a common personal handle, and "ropa" skips "europa".
 */
const USERNAME_SHOP =
  /tienda|store|shop|boutique|closet|import|fardo|cosmetic|perfum|juguet|joya|accesori|emprend|distribuidora|comercial|muebl|fajas|lenceria|(?<!eu)ropa|outfit|uftit|fashion|beauty|nails|skincare|makeup|maquillaje|pormayor|xmayor|ventas?(?!n)|vendo|remate|textil|decor|bazar|outlet|calzado|zapat|cartera|bolsos|ofertas|compritas|galeria|kids|toys|moda(?!l)/;
/** Category fallback from glued username words, used when title/bio don't name one. */
const USERNAME_CATEGORY: [LiveCategory, RegExp][] = [
  ['Ropa', /fardo|closet|boutique|(?<!eu)ropa|outfit|uftit|fashion|lenceria|fajas|calzado|zapat|moda(?!l)|jeans/],
  ['Belleza', /cosmetic|perfum|beauty|nails|skincare|makeup|maquillaje/],
  ['Accesorios', /joya|accesori|cartera|bolsos/],
  ['Juguetes', /juguet|toys/],
  ['Hogar', /muebl|decor|hogar/],
];
/** Bolivia or its main cities glued inside a username ("fardosboliviaofficial"). */
const USERNAME_BO =
  /bolivia|(?:^|[._])bol?(?:[._]|$)|scz|santacruz|cochabamba|cbba|lapaz|elalto|oruro|tarija|potosi|sucre|trinidad|cobija/;

/** Non-commerce streams; they only count as selling with a strong (title/hashtag) signal. */
const NON_SALES = [
  'gamer',
  'gaming',
  'free fire',
  'freefire',
  'partida',
  'musica',
  'karaoke',
  'cantando',
  'chill',
  'charla',
  'tarot',
  'oracion',
  'predica',
  'contratos',
];

@Injectable()
export class EcommerceClassifier {
  constructor(private readonly config: TikTokLivesConfig) {}
  classify(live: LiveCandidate, registeredLocalStore = false) {
    const text = normalizeText(
      [live.title, live.nickname, live.bio, ...live.tags].join(' '),
    );
    // Title/hashtags describe this broadcast; nickname/bio only describe the account.
    const roomText = normalizeText([live.title, ...live.tags].join(' '));
    const strongKeywords = SALES.filter((term) => contains(roomText, term));
    const matchedKeywords = SALES.filter((term) => contains(text, term));
    const nonSales =
      NON_SALES.some((term) => contains(text, term)) ||
      /gamer|gaming|music/.test(live.username);
    const regionText = `${text} ${live.username.replace(/[._]/g, ' ')}`;
    const regionMatch = [...this.config.regionTerms, ...(this.config.country === 'BO' ? ['🇧🇴'] : [])].find((term) =>
      contains(regionText, term),
    );
    const localUsername = this.config.country === 'BO' &&
      USERNAME_BO.test(live.username);
    const gluedUsername = live.username.replace(/[._\d]/g, '');
    const shopUsername = USERNAME_SHOP.test(gluedUsername);
    // Sellers post their order number far more often than the word "Bolivia".
    const localPhone =
      this.config.country === 'BO' &&
      [live.title, live.nickname, live.bio].some(
        (field) => !!field && !!extractWhatsApp(field),
      );
    const explicitCountry = live.countryCode?.toUpperCase();
    const foreignCountry =
      !!explicitCountry && explicitCountry !== this.config.country;
    // Never turn the browsing locale / proxy IP into a claim about seller location.
    const geoEvidence = foreignCountry
      ? null
      : registeredLocalStore
          ? 'registered_store'
          : explicitCountry === this.config.country
            ? 'tiktok_country'
            : regionMatch
              ? `keyword:${regionMatch}`
              : localUsername
                ? 'username:bo'
                : localPhone
                  ? 'phone:bo'
                  : null;
    // A price or an order number in the broadcast title is a sale even without sales words.
    const titleOffer =
      !!extractPrice(live.title) || !!extractWhatsApp(live.title);
    const isSelling =
      strongKeywords.length > 0 ||
      titleOffer ||
      ((matchedKeywords.length > 0 || shopUsername) && !nonSales);
    // Most matched terms wins, so "faldas y carteras" isn't decided by list order alone.
    const categoryScores = CATEGORY_TERMS.map(
      ([name, terms]) =>
        [name, terms.filter((term) => contains(text, term)).length] as const,
    );
    const best = categoryScores.reduce((a, b) => (b[1] > a[1] ? b : a));
    const usernameCategory = USERNAME_CATEGORY.find(([, pattern]) =>
      pattern.test(gluedUsername),
    )?.[0];
    return {
      isSelling,
      // Listed in the marketplace: selling, not explicitly abroad, and with regional evidence only if required.
      listable:
        isSelling &&
        !foreignCountry &&
        (!!geoEvidence || !this.config.requireRegion),
      category: best[1] > 0 ? best[0] : (usernameCategory ?? ('Otros' as LiveCategory)),
      geoEvidence,
      matchedKeywords,
      strongKeywords,
    };
  }
}
