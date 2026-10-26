import { Injectable } from '@nestjs/common';
import { TikTokLivesConfig } from './tiktok-lives.config';
import {
  LiveCandidate,
  LiveCategory,
  normalizeText,
} from './tiktok-lives.types';

const SALES = [
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
      'zapatillas',
      'calzado',
      'poleras',
      'jeans',
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
      'laptop',
      'tecnologia',
      'audifonos',
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
      'electrodomesticos',
    ],
  ],
  [
    'Belleza',
    ['belleza', 'maquillaje', 'cosmeticos', 'perfume', 'perfumes', 'skincare'],
  ],
];

function contains(text: string, term: string): boolean {
  const escaped = normalizeText(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`).test(text);
}

@Injectable()
export class EcommerceClassifier {
  constructor(private readonly config: TikTokLivesConfig) {}
  classify(live: LiveCandidate, registeredLocalStore = false) {
    const text = normalizeText([live.title, ...live.tags].join(' '));
    const matchedKeywords = SALES.filter((term) => contains(text, term));
    const regionMatch = this.config.regionTerms.find((term) =>
      contains(text, term),
    );
    const explicitCountry = live.countryCode?.toUpperCase();
    // Never turn the browsing locale / proxy IP into a claim about seller location.
    const geoEvidence =
      explicitCountry && explicitCountry !== this.config.country
        ? null
        : registeredLocalStore
          ? 'registered_store'
          : explicitCountry === this.config.country
            ? 'tiktok_country'
            : regionMatch
              ? `keyword:${regionMatch}`
              : null;
    return {
      isSelling: matchedKeywords.length > 0,
      category:
        CATEGORY_TERMS.find(([, terms]) =>
          terms.some((term) => contains(text, term)),
        )?.[0] ?? 'Otros',
      geoEvidence,
      matchedKeywords,
    };
  }
}
