import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { asUser, get } from './api.js';
import { shapeProduct } from './shape.js';

type Json = Record<string, any>;

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ isError: true, content: [{ type: 'text' as const, text: message }] });

/** Tools that act as the signed-in person. The HTTP layer asks for sign-in before any of them runs. */
export const ACCOUNT_TOOLS = new Set([
  'whoami', 'quote_delivery', 'place_order', 'my_orders', 'get_order',
  'my_store', 'store_orders', 'store_summary', 'my_offers', 'create_product', 'update_product', 'delete_product',
  'adjust_stock', 'update_offer', 'create_flash_deal', 'end_deals', 'update_store', 'request_courier',
]);

const READ = { readOnlyHint: true, openWorldHint: true } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
const DANGER = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;

const items = z
  .array(
    z.object({
      offer_id: z.string().describe('offerId de la oferta (sale en search_products / get_product)'),
      quantity: z.number().int().min(1).max(50).default(1),
      variant: z.string().max(80).optional().describe('Opción elegida (talla, sabor...) si el producto las tiene'),
    }),
  )
  .min(1)
  .max(30);

const toItems = (list: z.infer<typeof items>) => list.map((i) => ({ productOfferId: i.offer_id, quantity: i.quantity, variant: i.variant }));

export function registerAccountTools(server: McpServer, userId: string) {
  const run = <A>(fn: (args: A) => Promise<unknown>) => async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'No se pudo completar la acción');
    }
  };
  const api = <T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => asUser<T>(userId, method, path, body);
  const id = encodeURIComponent;

  // ---------- Cliente ----------
  server.registerTool('whoami', { title: 'Mi cuenta', description: 'Datos de la cuenta con la que se conectó el asistente.', inputSchema: {}, annotations: READ },
    run(async () => {
      const u = await api<Json>('GET', '/auth/me');
      return { name: u.name, phone: u.phone, address: u.address ?? null, hasStore: Boolean(u.storeId), role: u.role };
    }));

  server.registerTool('quote_delivery', {
    title: 'Cotizar envío',
    description: 'Precio de entrega para un carrito y una ubicación. Úsalo antes de place_order y muéstrale el total al cliente.',
    inputSchema: { items, latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) },
    annotations: READ,
  }, run(async ({ items: list, latitude, longitude }) => api('POST', '/orders/purchase/quote', { items: toItems(list), customerLat: latitude, customerLng: longitude })));

  server.registerTool('place_order', {
    title: 'Hacer pedido',
    description:
      'Crea el pedido con la cuenta del cliente. ANTES de llamarla muestra al cliente el resumen (productos, envío con quote_delivery, total, dirección, forma de pago) y pide su confirmación expresa; ' +
      'solo entonces llama con confirmed=true. Nunca la uses por iniciativa propia.',
    inputSchema: {
      items,
      customer_name: z.string().max(100).optional(),
      address: z.string().min(5).max(250).describe('Dirección de entrega'),
      reference: z.string().max(250).optional().describe('Referencia para llegar'),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      payment_method: z.string().max(40).describe('Forma de pago que acepta la tienda, ej. contra entrega o QR'),
      delivery_at: z.string().max(40).optional().describe('Fecha y hora de entrega, ISO 8601'),
      confirmed: z.literal(true).describe('true solo si el cliente aprobó el resumen'),
    },
    annotations: DANGER,
  }, run(async (a) => api('POST', '/orders/purchase', {
    items: toItems(a.items), customerName: a.customer_name, customerAddress: a.address, customerReference: a.reference,
    customerLat: a.latitude, customerLng: a.longitude, paymentMethod: a.payment_method, deliveryAt: a.delivery_at,
  })));

  server.registerTool('my_orders', { title: 'Mis pedidos', description: 'Pedidos recientes del cliente.', inputSchema: {}, annotations: READ },
    run(async () => {
      const orders = await api<Json[]>('GET', '/orders/mine');
      return orders.map((o) => ({ id: o.id, orderNumber: o.orderNumber, status: o.status, total: o.total, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus, createdAt: o.createdAt, trackingCode: o.trackingCode, items: (o.items ?? []).map((i: Json) => ({ title: i.productTitle, quantity: i.quantity })) }));
    }));

  server.registerTool('get_order', { title: 'Ver un pedido', description: 'Detalle de un pedido del cliente (por número o id).', inputSchema: { order: z.string().min(1).max(80) }, annotations: READ },
    run(async ({ order }) => api('GET', `/orders/${id(order)}`)));

  // ---------- Vendedor ----------
  server.registerTool('my_store', { title: 'Mi tienda', description: 'La tienda de la cuenta, con su id (necesario para las demás herramientas de vendedor).', inputSchema: {}, annotations: READ },
    run(async () => {
      const s = await api<Json>('GET', '/stores/mine');
      if (!s) return { hasStore: false, hint: 'Esta cuenta aún no tiene tienda. Se crea desde la web de Vitrina.' };
      return { id: s.id, slug: s.slug, name: s.name, description: s.description, address: s.address, phone: s.phone, tiktokUsername: s.tiktokUsername, deliveryDays: s.deliveryDays, deliveryStart: s.deliveryStart, deliveryEnd: s.deliveryEnd, paymentMethods: s.paymentMethods };
    }));

  server.registerTool('store_orders', { title: 'Pedidos de mi tienda', description: 'Pedidos que ha recibido la tienda. Con since (ISO) solo los nuevos.', inputSchema: { store_id: z.string(), since: z.string().max(40).optional() }, annotations: READ },
    run(async ({ store_id, since }) => api('GET', `/stores/${id(store_id)}/orders${since ? `?since=${id(since)}` : ''}`)));

  server.registerTool('store_summary', { title: 'Resumen de ventas', description: 'Métricas de ventas de la tienda.', inputSchema: { store_id: z.string() }, annotations: READ },
    run(async ({ store_id }) => api('GET', `/stores/${id(store_id)}/summary`)));

  server.registerTool('my_offers', { title: 'Mis productos y precios', description: 'Ofertas de la tienda con precio, stock y estado.', inputSchema: { store_id: z.string() }, annotations: READ },
    run(async ({ store_id }) => api('GET', `/stores/${id(store_id)}/offers`)));

  server.registerTool('create_product', {
    title: 'Publicar producto',
    description: 'Crea un producto en la tienda. Usa list_categories para obtener category_id (el id, no el slug).',
    inputSchema: {
      store_id: z.string(),
      title: z.string().min(3).max(150),
      description: z.string().max(2000).optional(),
      price: z.number().positive().describe('Precio en Bs.'),
      stock: z.number().int().min(0).max(100000),
      category_id: z.string(),
      images: z.array(z.string().url()).max(8).default([]).describe('URLs públicas de las fotos'),
      condition: z.string().max(30).optional(),
      variant_axis: z.string().max(40).optional().describe('Nombre de las opciones: Talla, Sabor...'),
      variants: z.array(z.object({ label: z.string().max(60), stock: z.number().int().min(0) })).max(40).optional(),
    },
    annotations: WRITE,
  }, run(async (a) => api('POST', '/products', {
    storeId: a.store_id, title: a.title, description: a.description, basePrice: a.price, stock: a.stock, categoryId: a.category_id,
    images: a.images, condition: a.condition, variantAxis: a.variant_axis ?? null, variants: a.variants ?? null,
  })));

  server.registerTool('update_product', {
    title: 'Editar producto',
    description: 'Cambia el título, la descripción o las fotos de un producto de tu tienda.',
    inputSchema: { product_id: z.string(), title: z.string().min(3).max(150).optional(), description: z.string().max(2000).optional(), images: z.array(z.string().url()).max(8).optional() },
    annotations: { ...WRITE, idempotentHint: true },
  }, run(async ({ product_id, ...rest }) => api('PUT', `/products/${id(product_id)}`, rest)));

  server.registerTool('delete_product', {
    title: 'Eliminar producto',
    description: 'Elimina un producto de tu tienda. No se puede deshacer: pide confirmación al dueño antes y llama con confirmed=true.',
    inputSchema: { product_id: z.string(), confirmed: z.literal(true) },
    annotations: DANGER,
  }, run(async ({ product_id }) => api('DELETE', `/products/${id(product_id)}`)));

  server.registerTool('adjust_stock', {
    title: 'Ajustar stock',
    description: '"Vendí una" (change = -1) o "llegaron más" (change > 0), opcionalmente para una opción.',
    inputSchema: { store_id: z.string(), offer_id: z.string(), change: z.number().int().min(-10000).max(10000), variant: z.string().max(80).optional() },
    annotations: WRITE,
  }, run(async ({ store_id, offer_id, change, variant }) => api('POST', `/stores/${id(store_id)}/offers/${id(offer_id)}/stock`, { change, variant })));

  server.registerTool('update_offer', {
    title: 'Cambiar precio o estado',
    description: 'Cambia el precio, el stock total o activa/pausa la oferta de un producto.',
    inputSchema: { store_id: z.string(), offer_id: z.string(), price: z.number().positive().optional(), stock: z.number().int().min(0).optional(), is_active: z.boolean().optional() },
    annotations: { ...WRITE, idempotentHint: true },
  }, run(async ({ store_id, offer_id, price, stock, is_active }) => api('PATCH', `/stores/${id(store_id)}/offers/${id(offer_id)}`, { price, stock, isActive: is_active })));

  server.registerTool('create_flash_deal', {
    title: 'Crear oferta con descuento',
    description: 'Pone un producto en oferta con precio rebajado por unas horas.',
    inputSchema: { store_id: z.string(), offer_id: z.string(), sale_price: z.number().positive().describe('Precio con descuento en Bs.'), duration_hours: z.number().min(1).max(168).default(24) },
    annotations: WRITE,
  }, run(async ({ store_id, offer_id, sale_price, duration_hours }) => api('POST', `/stores/${id(store_id)}/offers/flash`, { offerId: offer_id, salePrice: sale_price, durationHours: duration_hours })));

  server.registerTool('end_deals', {
    title: 'Terminar ofertas',
    description: 'Quita el descuento de las ofertas indicadas (el producto sigue a precio normal).',
    inputSchema: { store_id: z.string(), offer_ids: z.array(z.string()).min(1).max(100) },
    annotations: WRITE,
  }, run(async ({ store_id, offer_ids }) => api('POST', `/stores/${id(store_id)}/offers/end`, { offerIds: offer_ids })));

  server.registerTool('update_store', {
    title: 'Editar mi tienda',
    description: 'Cambia datos públicos de la tienda. No toca cobros, QR ni cuentas bancarias: eso solo se cambia desde la web.',
    inputSchema: {
      store_id: z.string(),
      description: z.string().max(600).optional(),
      address: z.string().max(250).optional(),
      phone: z.string().max(20).optional(),
      tiktok_username: z.string().max(60).optional(),
      delivery_days: z.string().max(40).optional(),
      delivery_start: z.string().max(10).optional(),
      delivery_end: z.string().max(10).optional(),
    },
    annotations: { ...WRITE, idempotentHint: true },
  }, run(async ({ store_id, tiktok_username, delivery_days, delivery_start, delivery_end, ...rest }) =>
    api('PATCH', `/stores/${id(store_id)}`, { ...rest, tiktokUsername: tiktok_username, deliveryDays: delivery_days, deliveryStart: delivery_start, deliveryEnd: delivery_end })));

  server.registerTool('request_courier', {
    title: 'Pedir repartidor',
    description: 'Envía un pedido de tu tienda a reparto ahora, sin esperar la hora programada. Confirma con el dueño antes.',
    inputSchema: { order_id: z.string(), confirmed: z.literal(true) },
    annotations: DANGER,
  }, run(async ({ order_id }) => api('POST', `/orders/${id(order_id)}/dispatch`)));

  void get; void shapeProduct;
}
