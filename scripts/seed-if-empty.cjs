// Seeds the demo catalogue on first boot only. prisma/seed.ts wipes tables, so it must never
// run against a database that already has data (e.g. a persisted Railway volume).
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  let categories;
  try {
    categories = await prisma.category.count();
  } finally {
    await prisma.$disconnect();
  }
  if (categories > 0) {
    console.log(`[seed] Base con datos (${categories} categorías); no se siembra.`);
    return;
  }
  console.log('[seed] Base vacía: sembrando catálogo inicial...');
  const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), 'prisma/seed.ts'], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    // Don't crash-loop the API if seeding fails; the marketplace just starts empty.
    console.error('[seed] La siembra falló; el backend inicia sin datos iniciales.');
  }
}

main().catch((error) => {
  console.error('[seed] No se pudo comprobar la base:', error.message);
  process.exit(1);
});
