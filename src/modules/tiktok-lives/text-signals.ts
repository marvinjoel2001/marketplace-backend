import { normalizeText } from './tiktok-lives.types';

/** Whole-word match on normalized text (accents removed, lowercase). */
export function contains(text: string, term: string): boolean {
  const escaped = normalizeText(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`).test(text);
}

/** Bolivian mobile (8 digits starting with 6 or 7) as an international number for wa.me. */
export function extractWhatsApp(title: string): string | null {
  const match = title.match(
    /(?<![\d+])(?:\+?\s*591[\s.-]?)?([67]\d{3})[\s.-]?(\d{4})(?!\d)/,
  );
  return match ? `591${match[1]}${match[2]}` : null;
}

const AMOUNT = '(\\d{1,5}(?:[.,]\\d{1,2})?)';

/** Price as written in the title ("Bs 45", "desde Bs 5", "3 x Bs 140"); null when unclear. */
export function extractPrice(title: string): string | null {
  const text = normalizeText(title);
  const combo = text.match(
    /(?<![\d.,])(\d{1,2})\s*x\s*(\d{1,5})\s*(?:bs|bob|bolivianos)\b/,
  );
  if (combo) return `${combo[1]} x Bs ${combo[2]}`;
  const currency = text.match(
    new RegExp(
      `(?:\\b(desde)\\s+)?(?:\\b(?:bs\\.?|bob)\\s*${AMOUNT}|(?<![\\d.,])${AMOUNT}\\s*(?:bs|bob|bolivianos)\\b)`,
    ),
  );
  if (currency)
    return `${currency[1] ? 'desde ' : ''}Bs ${currency[2] ?? currency[3]}`;
  // "vestidos a 45": a bare amount right after "a"/"desde", excluding times, distances and installments.
  const bare = text.match(
    /\b(desde|a)\s+(\d{1,4})(?![\d.,:])(?!\s*(?:am|pm|hrs?|horas|min|cuadras|km|%|x\b|cuotas|anos|meses|dias|personas))/,
  );
  if (bare && Number(bare[2]) >= 5)
    return `${bare[1] === 'desde' ? 'desde ' : ''}Bs ${bare[2]}`;
  return null;
}
