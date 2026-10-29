// Runs on every boot (see Dockerfile). The marketplace starts with real data only:
// 1. makes sure the product categories exist (stores need them to publish), and
// 2. removes the demo catalogue that older versions seeded (fake stores, products and lives).
// Only the demo stores' exact slugs are touched; stores created by sellers get a numeric suffix.
const { PrismaClient } = require('@prisma/client');

const CATEGORIES = [
  { name: 'Moda y Accesorios', slug: 'moda-y-accesorios', icon: 'Shirt', order: 1 },
  { name: 'Hogar y Muebles', slug: 'hogar-y-muebles', icon: 'Home', order: 2 },
  { name: 'Electrónica y Tecnología', slug: 'electronica-y-tecnologia', icon: 'Laptop', order: 3 },
  { name: 'Celulares y Telefonía', slug: 'celulares-y-telefonia', icon: 'Smartphone', order: 4 },
  { name: 'Deportes y Outdoors', slug: 'deportes-y-outdoors', icon: 'Dumbbell', order: 5 },
  { name: 'Belleza y Cuidado Personal', slug: 'belleza-y-cuidado-personal', icon: 'Sparkles', order: 6 },
  { name: 'Juguetes y Niños', slug: 'juguetes-y-ninos', icon: 'Gamepad2', order: 7 },
  { name: 'Abarrotes y Alimentos', slug: 'abarrotes-y-alimentos', icon: 'ShoppingBag', order: 8 },
  { name: 'Salud y Farmacia', slug: 'salud-y-farmacia', icon: 'HeartPulse', order: 9 },
  { name: 'Automotriz y Accesorios', slug: 'automotriz-y-accesorios', icon: 'Car', order: 10 },
  { name: 'Mascotas', slug: 'mascotas', icon: 'Dog', order: 11 },
];

const DEMO_STORE_SLUGS = [
  'techplus-bolivia',
  'modabol',
  'urban-store',
  'outfit-bolivia',
  'trendys',
  'tecnoshop',
  'hogar-feliz',
  'belleza-natural',
  'abarrotes-del-dia',
];

async function ensureCategories(prisma) {
  for (const cat of CATEGORIES) {
    await prisma.category.upsert({ where: { slug: cat.slug }, update: {}, create: cat });
  }
}

/** Deletes the given stores with their offers, lives, orders and the products only they sold. */
async function removeStores(prisma, slugs) {
  const stores = await prisma.store.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } });
  if (stores.length === 0) return 0;
  const storeIds = stores.map((s) => s.id);
  const offers = await prisma.productOffer.findMany({ where: { storeId: { in: storeIds } }, select: { productId: true } });
  const productIds = [...new Set(offers.map((o) => o.productId))];
  const items = await prisma.orderItem.findMany({ where: { storeId: { in: storeIds } }, select: { orderId: true } });
  const orderIds = [...new Set(items.map((i) => i.orderId))];

  await prisma.$transaction([
    prisma.orderItem.deleteMany({ where: { storeId: { in: storeIds } } }),
    // Orders left without items belonged only to these stores.
    prisma.order.deleteMany({ where: { id: { in: orderIds }, items: { none: {} } } }),
    prisma.user.updateMany({ where: { storeId: { in: storeIds } }, data: { storeId: null, role: 'CUSTOMER' } }),
    // Offers, lives, coupons and the TikTok link cascade with the store.
    prisma.store.deleteMany({ where: { id: { in: storeIds } } }),
    prisma.product.deleteMany({ where: { id: { in: productIds }, offers: { none: {} } } }),
  ]);
  return stores.length;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await ensureCategories(prisma);
    // Extra slugs can be passed for a one-off cleanup: node scripts/seed-if-empty.cjs some-store-1234
    const removed = await removeStores(prisma, [...DEMO_STORE_SLUGS, ...process.argv.slice(2)]);
    if (removed > 0) console.log(`[datos] Se quitaron ${removed} tiendas de demostración con sus productos y lives.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // Don't block the API from starting over a cleanup problem.
  console.error('[datos] No se pudo preparar la base:', error.message);
});
