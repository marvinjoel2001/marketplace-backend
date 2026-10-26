// Run one complete cycle without waiting for the next cron tick. Requires npm run build.
require('dotenv').config();
// This command awaits each job itself; avoid a second background startup cycle.
process.env.TIKTOK_RUN_ON_STARTUP = 'false';
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { TikTokLivesConfig } = require('../dist/modules/tiktok-lives/tiktok-lives.config');
const { TikTokLivesWorker } = require('../dist/modules/tiktok-lives/tiktok-lives.worker');
const { TikTokLivesService } = require('../dist/modules/tiktok-lives/tiktok-lives.service');

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error', 'log'] });
  try {
    if (!app.get(TikTokLivesConfig).enabled) throw new Error('Configura TIKTOK_LIVES_ENABLED=true antes de sincronizar');
    const worker = app.get(TikTokLivesWorker);
    await worker.registeredStores();
    await worker.discover();
    const result = await app.get(TikTokLivesService).active({ limit: '100' });
    console.log(JSON.stringify({
      active: result.pagination.total,
      cache: result.meta.cache,
      lives: result.data.map(live => ({ username: live.username, title: live.title, viewers: live.viewer_count, live_url: live.live_url })),
    }, null, 2));
    if (!result.pagination.total) {
      console.error('No hay ventas verificadas vigentes. Revisa los avisos de exploración, verificación y Redis.');
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
})().catch(() => {
  console.error('La sincronización TikTok no pudo completarse. Comprueba compilación, configuración y base de datos.');
  process.exitCode = 1;
});
