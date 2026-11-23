import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { get, WEB_URL } from './api.js';
import { authEnabled } from './tokens.js';
import { registerAccountTools } from './account-tools.js';
import { shapeLive, shapeProduct, shapeScraped, shapeStore } from './shape.js';

type Json = Record<string, any>;

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ isError: true, content: [{ type: 'text' as const, text: message }] });
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

/** Wraps a tool so API failures come back as a readable error instead of crashing the session. */
function safe<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'No se pudo consultar el marketplace');
    }
  };
}

/** `userId` is empty for anonymous callers: the account tools are still listed so the assistant offers sign-in when needed. */
export function createServer(userId = '') {
  const server = new McpServer(
    { name: 'vitrina-market', version: '1.0.0' },
    {
      instructions:
        'Vitrina Market es un marketplace de tiendas de Bolivia (precios en bolivianos, BOB). ' +
        'Usa estas herramientas para buscar productos, ver ofertas, tiendas y lives. ' +
        'Sin sesión solo puedes consultar. Con la cuenta conectada puedes cotizar, hacer pedidos y administrar la tienda del usuario. ' +
        'Antes de place_order, delete_product o request_courier muestra un resumen y pide confirmación expresa. Entrega siempre el "url" del producto.',
    },
  );

  server.registerTool(
    'search_products',
    {
      title: 'Buscar productos',
      description: 'Busca productos del marketplace por texto y/o categoría. Devuelve precios en Bs., stock, tienda y enlace de compra.',
      inputSchema: {
        query: z.string().max(120).optional().describe('Texto a buscar, ej. "singani", "audífonos"'),
        category: z.string().max(80).optional().describe('Slug de la categoría (usa list_categories), ej. "licorerias"'),
        max_price: z.number().positive().optional().describe('Precio máximo en Bs.'),
        in_stock_only: z.boolean().default(true).describe('Solo productos con stock'),
        limit: z.number().int().min(1).max(30).default(10),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ query, category, max_price, in_stock_only, limit }) => {
      const qs = new URLSearchParams();
      if (query) qs.set('q', query);
      if (category) qs.set('category', category);
      const products = (await get<Json[]>(`/products${qs.size ? `?${qs}` : ''}`)).map(shapeProduct);
      const filtered = products
        .filter((p) => p.offers.length > 0)
        .filter((p) => !in_stock_only || p.offers.some((o: Json) => o.inStock))
        .filter((p) => max_price == null || (p.fromPrice != null && p.fromPrice <= max_price));
      return { total: filtered.length, products: filtered.slice(0, limit) };
    }),
  );

  server.registerTool(
    'get_product',
    {
      title: 'Ver un producto',
      description: 'Detalle de un producto (por slug) con todas sus ofertas por tienda, opciones y enlace de compra.',
      inputSchema: { slug: z.string().min(1).max(160).describe('Slug del producto, tal como sale en search_products') },
      annotations: READ_ONLY,
    },
    safe(async ({ slug }) => shapeProduct(await get<Json>(`/products/${encodeURIComponent(slug)}`))),
  );

  server.registerTool(
    'list_deals',
    {
      title: 'Ofertas activas',
      description: 'Productos con descuento activo ahora mismo, con precio original, precio con descuento y cuándo termina.',
      inputSchema: { limit: z.number().int().min(1).max(30).default(10) },
      annotations: READ_ONLY,
    },
    safe(async ({ limit }) => {
      const products = (await get<Json[]>('/products?flashSale=true')).map(shapeProduct);
      const deals = products.filter((p) => p.offers.some((o: Json) => o.discountPercent));
      deals.sort((a, b) => Math.max(...b.offers.map((o: Json) => o.discountPercent ?? 0)) - Math.max(...a.offers.map((o: Json) => o.discountPercent ?? 0)));
      return { total: deals.length, deals: deals.slice(0, limit) };
    }),
  );

  server.registerTool(
    'list_categories',
    {
      title: 'Categorías',
      description: 'Categorías disponibles (incluye Licorerías). Usa el slug en search_products.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(async () => {
      const cats = await get<Json[]>('/categories');
      return cats.map((c) => ({ name: c.name, slug: c.slug, url: `${WEB_URL}/?category=${c.slug}` }));
    }),
  );

  server.registerTool(
    'list_stores',
    {
      title: 'Tiendas',
      description: 'Tiendas registradas en Vitrina. Con live_only=true solo las que están transmitiendo en vivo.',
      inputSchema: { live_only: z.boolean().default(false), limit: z.number().int().min(1).max(50).default(20) },
      annotations: READ_ONLY,
    },
    safe(async ({ live_only, limit }) => {
      const stores = await get<Json[]>(`/stores${live_only ? '?isLive=true' : ''}`);
      return stores.slice(0, limit).map(shapeStore);
    }),
  );

  server.registerTool(
    'get_store',
    {
      title: 'Ver una tienda',
      description: 'Datos públicos de una tienda y los productos que vende.',
      inputSchema: { slug: z.string().min(1).max(120), product_limit: z.number().int().min(1).max(30).default(12) },
      annotations: READ_ONLY,
    },
    safe(async ({ slug, product_limit }) => {
      const store = await get<Json>(`/stores/${encodeURIComponent(slug)}`);
      const offers: Json[] = (store.offers ?? []).filter((o: Json) => o.product && o.isActive !== false);
      const products = offers.slice(0, product_limit).map((o) => shapeProduct({ ...o.product, offers: [{ ...o, store }] }));
      return { store: shapeStore(store), products };
    }),
  );

  server.registerTool(
    'live_now',
    {
      title: 'Quién está en vivo',
      description:
        'Lives de TikTok ahora. Da prioridad a las tiendas registradas en Vitrina (se compra dentro); ' +
        'solo si ninguna está en vivo devuelve los lives encontrados en TikTok.',
      inputSchema: { limit: z.number().int().min(1).max(20).default(10) },
      annotations: READ_ONLY,
    },
    safe(async ({ limit }) => {
      const registered = await get<Json[]>('/stores/live');
      if (registered.length > 0) return { source: 'registered_stores', lives: registered.slice(0, limit).map(shapeLive) };
      const tiktok = await get<{ data?: Json[] }>(`/tiktok-lives/active?limit=${limit}`).catch(() => ({ data: [] as Json[] }));
      return { source: 'tiktok_scraper', lives: (tiktok.data ?? []).slice(0, limit).map(shapeScraped) };
    }),
  );

  if (authEnabled) registerAccountTools(server, userId);
  return server;
}
