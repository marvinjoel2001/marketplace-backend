import { BadRequestException } from '@nestjs/common';

/** One option of a product (a size, a shoe number, a voltage, a bottle size, ...) and how many are left. */
export interface Variant {
  label: string;
  stock: number;
}

export const CONDITIONS = ['NUEVO', 'SEMINUEVO', 'USADO'] as const;
export const AUDIENCES = ['Mujer', 'Hombre', 'Unisex', 'Niños', 'Bebés', 'Todos'] as const;

/** Reads the JSON stored on ProductOffer.variants; anything malformed counts as "no options". */
export function parseVariants(raw: string | null | undefined): Variant[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list)
      ? list
          .filter((v) => v && typeof v.label === 'string' && v.label.trim())
          .map((v) => ({ label: String(v.label).trim(), stock: Math.max(0, Math.floor(Number(v.stock) || 0)) }))
      : [];
  } catch {
    return [];
  }
}

/** Validates options sent by the seller. Returns null when the product has none. */
export function normalizeVariants(input: unknown): Variant[] | null {
  if (input === null || input === undefined || input === '') return null;
  const list = typeof input === 'string' ? safeJson(input) : input;
  if (!Array.isArray(list)) throw new BadRequestException('Las opciones del producto no son válidas');
  const seen = new Set<string>();
  const variants: Variant[] = [];
  for (const item of list) {
    const label = String(item?.label ?? '').trim().slice(0, 40);
    if (!label) continue;
    const key = label.toLocaleLowerCase('es');
    if (seen.has(key)) throw new BadRequestException(`La opción "${label}" está repetida`);
    const stock = Number(item?.stock ?? 0);
    if (!Number.isInteger(stock) || stock < 0) throw new BadRequestException(`Revisa la cantidad de "${label}"`);
    seen.add(key);
    variants.push({ label, stock });
  }
  if (variants.length > 40) throw new BadRequestException('Usa como máximo 40 opciones');
  return variants.length ? variants : null;
}

export function totalStock(variants: Variant[]): number {
  return variants.reduce((sum, v) => sum + v.stock, 0);
}

/** Free text such as "Talla" or "Voltaje"; empty means the product has no options. */
export function normalizeAxis(input: unknown): string | null {
  const axis = String(input ?? '').trim().slice(0, 30);
  return axis || null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
