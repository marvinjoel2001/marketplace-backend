import { WEB_URL } from './api.js';

/* Solo se publican campos seguros: nunca QR de cobro, cuenta bancaria, teléfonos ni dueños. */

type Json = Record<string, any>;

export function priceOf(offer: Json): { price: number; originalPrice: number | null; discountPercent: number | null } {
  const sale = offer.salePrice ?? null;
  const flashActive = !offer.flashSaleEnd || new Date(offer.flashSaleEnd).getTime() > Date.now();
  if (sale != null && sale < offer.price && flashActive) {
    return { price: sale, originalPrice: offer.price, discountPercent: Math.round((1 - sale / offer.price) * 100) };
  }
  return { price: offer.price, originalPrice: null, discountPercent: null };
}

function images(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean).map(String).filter((u) => !u.startsWith('data:'));
  } catch {
    return [];
  }
}

export function shapeStore(s: Json) {
  return {
    name: s.name,
    slug: s.slug,
    description: s.description ?? null,
    category: s.category ?? null,
    address: s.address ?? null,
    isLiveNow: Boolean(s.isLiveNow),
    tiktok: s.tiktokUsername ? `https://www.tiktok.com/@${s.tiktokUsername}` : null,
    deliveryDays: s.deliveryDays ?? null,
    deliveryHours: s.deliveryStart && s.deliveryEnd ? `${s.deliveryStart}–${s.deliveryEnd}` : null,
    url: `${WEB_URL}/en-vivo/${s.slug}`,
  };
}

export function shapeProduct(p: Json) {
  const offers = (p.offers ?? [])
    .filter((o: Json) => o.isActive !== false)
    .map((o: Json) => ({
      offerId: o.id,
      store: o.store?.name ?? null,
      storeSlug: o.store?.slug ?? null,
      ...priceOf(o),
      currency: 'BOB',
      inStock: (o.stock ?? 0) > 0,
      stock: o.stock ?? 0,
      options: o.variantAxis ? { name: o.variantAxis, values: safeJson(o.variants) } : null,
      dealEndsAt: o.flashSaleEnd ?? null,
    }))
    .sort((a: Json, b: Json) => a.price - b.price);
  return {
    title: p.title,
    slug: p.slug,
    productId: p.id,
    description: p.description ?? null,
    category: p.category?.name ?? null,
    condition: p.condition ?? null,
    images: images(p.images).slice(0, 4),
    offers,
    fromPrice: offers[0]?.price ?? null,
    url: `${WEB_URL}/product/${p.slug}`,
  };
}

function safeJson(raw: unknown) {
  try {
    const v = JSON.parse(String(raw ?? 'null'));
    return Array.isArray(v) ? v.map((x: Json) => ({ label: x.label, inStock: (x.stock ?? 0) > 0 })) : null;
  } catch {
    return null;
  }
}

export function shapeLive(l: Json) {
  return {
    kind: 'registered_store' as const,
    store: shapeStore({ ...l.store, isLiveNow: true }),
    title: l.title ?? null,
    viewers: l.viewerCount ?? 0,
    watchUrl: l.store?.tiktokUsername ? `${WEB_URL}/live/${l.store.tiktokUsername}` : `${WEB_URL}/en-vivo/${l.store?.slug}`,
    featuredProducts: (l.offers ?? []).slice(0, 6).map((o: Json) => ({
      title: o.product?.title,
      slug: o.product?.slug,
      ...priceOf(o),
      url: `${WEB_URL}/product/${o.product?.slug}`,
    })),
  };
}

export function shapeScraped(t: Json) {
  return {
    kind: 'tiktok_scraper' as const,
    username: t.username,
    title: t.title ?? null,
    city: t.city ?? null,
    viewers: t.viewer_count ?? 0,
    watchUrl: `${WEB_URL}/live/${t.username}`,
    note: 'Tienda no registrada en Vitrina: la compra se coordina por TikTok.',
  };
}
