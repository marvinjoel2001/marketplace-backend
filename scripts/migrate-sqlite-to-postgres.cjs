const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
const { PrismaClient, Prisma } = require('@prisma/client');

const MARKER = 'database.sqlite-to-postgresql.v1';
const quoted = value => `"${value.replaceAll('"', '""')}"`;
const delegate = model => model.name[0].toLowerCase() + model.name.slice(1);

function orderedModels(models) {
  const pending = new Map(models.map(model => [model.name, model]));
  const ordered = [];
  while (pending.size) {
    const ready = [...pending.values()].filter(model => !model.fields.some(field =>
      field.kind === 'object' && field.relationFromFields?.length && pending.has(field.type),
    ));
    if (!ready.length) throw new Error('Cyclic model dependencies: migration requires an explicit order.');
    for (const model of ready) { ordered.push(model); pending.delete(model.name); }
  }
  return ordered;
}

function readRows(sqlite, model) {
  const table = model.dbName || model.name;
  const columns = sqlite.prepare(`PRAGMA table_info(${quoted(table)})`).all();
  if (!columns.length) throw new Error(`Source table is missing: ${table}`);
  const fields = model.fields.filter(field => field.kind !== 'object' && columns.some(column => column.name === (field.dbName || field.name)));
  const statement = sqlite.prepare(`SELECT * FROM ${quoted(table)}`);
  statement.setReadBigInts(true);
  return statement.all().map(row => Object.fromEntries(fields.map(field => {
    let value = row[field.dbName || field.name];
    if (value !== null) {
      if (field.type === 'DateTime') {
        if (typeof value === 'bigint') value = Number(value);
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)) value = value.replace(' ', 'T') + 'Z';
        value = new Date(value);
        if (Number.isNaN(value.getTime())) throw new Error(`Invalid source date in ${model.name}.${field.name}`);
      } else if (field.type === 'Boolean') {
        if (![0, 1, 0n, 1n, false, true].includes(value)) throw new Error(`Invalid source boolean in ${model.name}.${field.name}`);
        value = Boolean(value);
      } else if (typeof value === 'bigint' && field.type !== 'BigInt') {
        if (!Number.isSafeInteger(Number(value))) throw new Error(`Unsafe integer in ${model.name}.${field.name}`);
        value = Number(value);
      }
    }
    return [field.name, value];
  })));
}

async function migrate(options = {}) {
  const source = path.resolve(options.source || process.env.SQLITE_MIGRATION_PATH || '');
  const target = options.client || new PrismaClient();
  const models = orderedModels(Prisma.dmmf.datamodel.models);
  try {
    if (await target.appSetting.findUnique({ where: { key: MARKER } })) {
      console.log('[postgres-migration] Already completed; source data will not be replayed.');
      return { skipped: true };
    }
    if (!fs.statSync(source).isFile()) throw new Error('The SQLite source is not a file.');
    const backupDir = options.backupDir || path.join(path.dirname(source), 'backups');
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const snapshot = path.join(backupDir, `marketplace-before-postgresql-${Date.now()}.db`);
    const original = new DatabaseSync(source, { readOnly: true });
    try { await backup(original, snapshot); } finally { original.close(); }
    fs.chmodSync(snapshot, 0o600);
    const sha256 = createHash('sha256').update(fs.readFileSync(snapshot)).digest('hex');
    const sqlite = new DatabaseSync(snapshot, { readOnly: true });
    let rows;
    try { rows = models.map(model => ({ model, rows: readRows(sqlite, model) })); }
    finally { sqlite.close(); }
    const counts = Object.fromEntries(rows.map(item => [item.model.name, item.rows.length]));
    if (rows.find(item => item.model.name === 'AppSetting').rows.some(row => row.key === MARKER)) {
      throw new Error('The source already contains the reserved migration marker.');
    }
    await target.$transaction(async tx => {
      // Serialize starts from multiple replicas; a successful import is never repeated.
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(791036211)');
      if (await tx.appSetting.findUnique({ where: { key: MARKER } })) return;
      for (const model of models) {
        if (await tx[delegate(model)].count()) throw new Error(`Target table ${model.name} is not empty. No existing data was overwritten.`);
      }
      for (const item of rows) {
        const table = tx[delegate(item.model)];
        for (let i = 0; i < item.rows.length; i += 200) {
          await table.createMany({ data: item.rows.slice(i, i + 200) });
        }
        if (await table.count() !== item.rows.length) throw new Error(`Row count mismatch for ${item.model.name}`);
        console.log(`[postgres-migration] ${item.model.name}: ${item.rows.length} rows verified`);
      }
      await tx.appSetting.create({ data: { key: MARKER, value: JSON.stringify({ completedAt: new Date().toISOString(), source: path.basename(source), backup: path.basename(snapshot), sha256, counts }) } });
    }, { maxWait: 30000, timeout: 180000 });
    console.log('[postgres-migration] Import committed. Original SQLite and its backup were retained.');
    return { counts, snapshot, sha256 };
  } finally {
    if (!options.client) await target.$disconnect();
  }
}

module.exports = { migrate, orderedModels, readRows, MARKER };
if (require.main === module) migrate().catch(error => {
  console.error('[postgres-migration]', String(error.message).replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[database URL redacted]'));
  process.exitCode = 1;
});
