const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { PrismaClient, Prisma } = require('@prisma/client');
const { migrate, orderedModels, readRows } = require('./migrate-sqlite-to-postgres.cjs');

(async () => {
  const schema = `qa_rehearsal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const url = new URL(process.env.MIGRATION_TEST_DATABASE_URL); url.searchParams.set('schema', schema);
  const source = process.env.MIGRATION_REHEARSAL_SOURCE;
  assert.ok(source && fs.statSync(source).isFile(), 'A consistent source backup is required');
  const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  let total = 0;
  try {
    const deploy = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8' });
    assert.equal(deploy.status, 0, 'Rehearsal schema migration');
    await migrate({ source, client, backupDir: path.join(path.dirname(source), 'rehearsal-backups') });
    const sqlite = new DatabaseSync(source, { readOnly: true });
    try {
      for (const model of orderedModels(Prisma.dmmf.datamodel.models)) {
        const original = readRows(sqlite, model);
        const copied = await client[model.name[0].toLowerCase() + model.name.slice(1)].findMany();
        const primary = model.fields.filter(field => field.isId).map(field => field.name);
        assert.ok(primary.length, `Primary key: ${model.name}`);
        const key = row => JSON.stringify(primary.map(field => row[field]));
        const copiedByKey = new Map(copied.map(row => [key(row), row]));
        for (const row of original) {
          const actual = copiedByKey.get(key(row));
          assert.ok(actual, `Missing row in ${model.name}`);
          for (const field of Object.keys(row)) assert.deepEqual(actual[field], row[field], `Field differs: ${model.name}.${field}`);
        }
        total += original.length;
        console.log(`PASS full value comparison: ${model.name}: ${original.length} rows`);
      }
    } finally { sqlite.close(); }
    console.log(`PASS production-backup rehearsal: ${total} rows; all scalar values and IDs preserved`);
  } finally {
    assert.match(schema, /^qa_rehearsal_\d+_[a-z0-9]+$/);
    await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.$disconnect();
  }
})().catch(error => { console.error(String(error.stack).replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[database URL redacted]')); process.exitCode = 1; });
