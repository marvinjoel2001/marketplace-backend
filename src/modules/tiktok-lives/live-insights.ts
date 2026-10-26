import { SALES } from './ecommerce-classifier.service';
import { contains } from './text-signals';
import { normalizeText } from './tiktok-lives.types';

export { extractPrice, extractWhatsApp } from './text-signals';

/** City filter values, with the spellings sellers use in titles and usernames. */
export const CITY_TERMS: [string, string[]][] = [
  ['Santa Cruz', ['santa cruz', 'santacruz', 'scz', 'montero', 'warnes']],
  ['La Paz', ['la paz', 'lapaz', 'lpz']],
  ['El Alto', ['el alto', 'elalto']],
  ['Cochabamba', ['cochabamba', 'cbba', 'cocha', 'quillacollo', 'sacaba']],
  ['Sucre', ['sucre']],
  ['Tarija', ['tarija']],
  ['Oruro', ['oruro']],
  ['Potosí', ['potosi']],
  ['Beni', ['beni', 'trinidad', 'riberalta']],
  ['Pando', ['pando', 'cobija']],
];
export const CITIES = CITY_TERMS.map(([city]) => city);

export function detectCity(texts: string[]): string | null {
  const text = normalizeText(texts.join(' ').replace(/[._]/g, ' '));
  return (
    CITY_TERMS.find(([, terms]) => terms.some((term) => contains(text, term)))?.[0] ??
    null
  );
}

/** Ranking signal: how clearly the broadcast itself (not just the account) is a sale. */
export function salesScore(live: {
  title: string;
  tags: string[];
  category: string;
  price: string | null;
  whatsapp: string | null;
}): number {
  const roomText = normalizeText([live.title, ...live.tags].join(' '));
  return (
    (SALES.some((term) => contains(roomText, term)) ? 3 : 0) +
    (live.price ? 2 : 0) +
    (live.whatsapp ? 1 : 0) +
    (live.category !== 'Otros' ? 1 : 0)
  );
}
