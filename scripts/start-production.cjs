const { spawnSync } = require('node:child_process');

function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
  if (result.error || result.status !== 0) throw new Error(`Startup step failed: ${args[0]}`);
}

async function main() {
  if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL || '')) {
    throw new Error('DATABASE_URL must point to PostgreSQL. The API has not started.');
  }
  run([require.resolve('prisma/build/index.js'), 'migrate', 'deploy']);
  if (process.env.SQLITE_MIGRATION_PATH) {
    await require('./migrate-sqlite-to-postgres.cjs').migrate();
  }
  run([require.resolve('./seed-if-empty.cjs')]);
  require('../dist/main.js');
}

main().catch(error => {
  console.error('[startup]', String(error.message).replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[database URL redacted]'));
  process.exitCode = 1;
});
