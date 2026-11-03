// Uses a fresh, uniquely named schema; never changes the public production schema.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { PrismaClient } = require('@prisma/client');
const { migrate, MARKER } = require('./migrate-sqlite-to-postgres.cjs');

async function main() {
  const database = process.env.MIGRATION_TEST_DATABASE_URL;
  if (!database || !/^postgres(?:ql)?:\/\//.test(database)) throw new Error('Set MIGRATION_TEST_DATABASE_URL to PostgreSQL.');
  const schemaName = `qa_migration_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const url = new URL(database); url.searchParams.set('schema', schemaName);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vitrina-postgres-migration-test-'));
  const schema = path.join(folder, 'schema.prisma');
  fs.writeFileSync(schema, fs.readFileSync(path.resolve('prisma/schema.prisma'), 'utf8').replace('provider = "postgresql"', 'provider = "sqlite"'));
  const diff = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', schema, '--script'], { env: { ...process.env, DATABASE_URL: 'file:./test.db' }, encoding: 'utf8' });
  assert.equal(diff.status, 0, 'SQLite fixture schema creation');
  const source = path.join(folder, 'source.db');
  const sqlite = new DatabaseSync(source);
  const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    sqlite.exec(diff.stdout);
    const at = Date.UTC(2026, 10, 2, 20, 30);
    sqlite.prepare('INSERT INTO "User" (id,email,name,createdAt,updatedAt) VALUES (?,?,?,?,?)').run('qa-user', 'qa@example.invalid', 'QA migración áéñ', at, at);
    sqlite.prepare('INSERT INTO "Store" (id,name,slug,logo,category,address,createdAt,updatedAt,isOfficial) VALUES (?,?,?,?,?,?,?,?,?)').run('qa-store', 'Tienda QA', 'qa-migration', '/uploads/test.png', 'Ropa', 'Dirección ficticia', at, at, 1);
    sqlite.prepare('INSERT INTO "Category" (id,name,slug,icon) VALUES (?,?,?,?)').run('qa-category', 'Moda', 'qa-moda', 'Shirt');
    sqlite.prepare('INSERT INTO "Product" (id,title,slug,description,basePrice,categoryId,images,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)').run('qa-product', 'Producto QA', 'qa-product', 'Descripción QA', 12.34, 'qa-category', '["/uploads/test.png"]', at, at);
    sqlite.prepare('INSERT INTO "ProductOffer" (id,productId,storeId,price,stock,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)').run('qa-offer', 'qa-product', 'qa-store', 12.34, 3, at, at);
    sqlite.prepare('INSERT INTO "AppSetting" (key,value,updatedAt) VALUES (?,?,?)').run('qa-setting', '{"nested":"conservar"}', '2026-11-02 20:30:00');
    const deploy = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8' });
    assert.equal(deploy.status, 0, `PostgreSQL test schema creation: ${deploy.stderr}`);

    await client.category.create({ data: { id: 'already-there', name: 'Existing', slug: 'existing', icon: 'x' } });
    await assert.rejects(migrate({ source, client }), /not empty/);
    assert.equal(await client.category.count(), 1);
    assert.equal(await client.user.count(), 0);
    await client.category.delete({ where: { id: 'already-there' } });
    console.log('PASS: nonempty targets are preserved');

    sqlite.exec('PRAGMA foreign_keys=OFF');
    sqlite.prepare('UPDATE "Product" SET categoryId=? WHERE id=?').run('missing-category', 'qa-product');
    await assert.rejects(migrate({ source, client }));
    assert.equal(await client.user.count(), 0);
    assert.equal(await client.store.count(), 0);
    assert.equal(await client.category.count(), 0);
    assert.equal(await client.appSetting.count(), 0);
    sqlite.prepare('UPDATE "Product" SET categoryId=? WHERE id=?').run('qa-category', 'qa-product');
    console.log('PASS: failed import rolls back every table');

    const imported = await migrate({ source, client });
    assert.equal(imported.counts.User, 1);
    assert.ok(fs.existsSync(imported.snapshot));
    const user = await client.user.findUnique({ where: { id: 'qa-user' } });
    assert.equal(user.createdAt.getTime(), at);
    assert.equal(user.name, 'QA migración áéñ');
    assert.equal((await client.store.findUnique({ where: { id: 'qa-store' } })).isOfficial, true);
    assert.equal((await client.product.findUnique({ where: { id: 'qa-product' } })).basePrice, 12.34);
    assert.equal((await client.appSetting.findUnique({ where: { key: 'qa-setting' } })).updatedAt.toISOString(), '2026-11-02T20:30:00.000Z');
    assert.ok(await client.appSetting.findUnique({ where: { key: MARKER } }));
    assert.equal((await migrate({ source, client })).skipped, true);
    assert.equal(await client.user.count(), 1);
    console.log('PASS: rows, IDs, relations, decimals, dates, booleans, backup and restart idempotency');
  } finally {
    sqlite.close();
    // This name was generated above, never taken from configuration or another database.
    assert.match(schemaName, /^qa_migration_\d+_[a-z0-9]+$/);
    await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await client.$disconnect();
    const resolved = path.resolve(folder);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('vitrina-postgres-migration-test-'));
    fs.rmSync(resolved, { recursive: true });
  }
}
main().catch(error => {
  console.error(String(error.stack).replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[database URL redacted]'));
  process.exitCode = 1;
});
