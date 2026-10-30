import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaService } from '../../../prisma/prisma.service';
import { EcommerceClassifier } from '../ecommerce-classifier.service';
import { TikTokLiveCache } from '../tiktok-live-cache.service';
import { TikTokLivesConfig } from '../tiktok-lives.config';
import { TikTokLivesController } from '../tiktok-lives.controller';
import { LiveFeedService } from '../live-feed.service';
import { TikTokLivesService } from '../tiktok-lives.service';

describe('TikTok LIVE API + SQLite integration (isolated database)', () => {
  let app: INestApplication;
  let db: PrismaClient;
  let folder: string;
  let base: string;
  let service: TikTokLivesService;
  const key = 'integration-test-key-not-a-secret-12345';
  const config: any = {
    country: 'BO',
    enabled: false,
    regionTerms: ['bolivia'],
    adminKey: key,
  };

  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'vitrina-tiktok-test-'));
    const url = `file:${join(folder, 'test.db').replace(/\\/g, '/')}`;
    const schema = join(folder, 'schema.prisma');
    writeFileSync(schema, readFileSync(resolve('prisma/schema.prisma')));
    writeFileSync(join(folder, 'test.db'), '');
    execFileSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'db',
        'push',
        '--schema',
        schema,
        '--skip-generate',
      ],
      {
        env: { ...process.env, DATABASE_URL: 'file:./test.db' },
        stdio: 'pipe',
      },
    );
    db = new PrismaClient({ datasources: { db: { url } } });
    const sql = readFileSync(resolve('prisma/sql/tiktok-lives.sql'), 'utf8');
    // The additive SQL can safely be reapplied to an existing schema.
    for (const statement of sql.split(';').filter((s) => s.trim()))
      await db.$executeRawUnsafe(statement);
    const module = await Test.createTestingModule({
      controllers: [TikTokLivesController],
      providers: [
        TikTokLivesService,
        EcommerceClassifier,
        TikTokLiveCache,
        { provide: PrismaService, useValue: db },
        { provide: TikTokLivesConfig, useValue: config },
        { provide: LiveFeedService, useValue: { snapshot: jest.fn() } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api/v1/tiktok-lives`;
    service = module.get(TikTokLivesService);
    await db.store.create({
      data: {
        id: 'local-store',
        name: 'Tienda Local',
        slug: 'local-test',
        category: 'Ropa',
        address: 'Calle local',
        logo: 'https://example.com/logo.png',
      },
    });
  }, 30000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    if (folder) {
      // Delete only files directly in this exact temporary test directory, without recursive removal.
      for (const filename of readdirSync(folder))
        unlinkSync(join(folder, filename));
      rmdirSync(folder);
    }
  });

  it('registra una tienda, publica un live verificado, pagina y lo retira al finalizar', async () => {
    const denied = await fetch(`${base}/stores/local-store/account`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tiktok_username: 'tienda' }),
    });
    expect(denied.status).toBe(403);
    const registered = await fetch(`${base}/stores/local-store/account`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-tiktok-admin-key': key,
      },
      body: JSON.stringify({ tiktok_username: '@Tienda' }),
    });
    expect(registered.status).toBe(200);
    expect(
      await db.tikTokAccount.findUnique({ where: { username: 'tienda' } }),
    ).toMatchObject({ storeId: 'local-store', countryCode: 'BO' });
    await service.saveVerified(
      {
        username: 'tienda',
        roomId: '7450012345678901234',
        title: 'Remate de ropa',
        viewerCount: 40,
        tags: ['tienda'],
      },
      { id: 'local-store', category: 'Ropa', address: 'Calle local' },
    );
    const response = await fetch(`${base}/active?category=ropa&limit=1`);
    const body: any = await response.json();
    expect(response.status).toBe(200);
    expect(body.data[0]).toMatchObject({
      username: 'tienda',
      geo_evidence: 'registered_store',
      category: 'Ropa',
      room_id: '7450012345678901234',
    });
    expect(
      (await db.store.findUnique({ where: { id: 'local-store' } })).isLiveNow,
    ).toBe(true);
    expect((await fetch(`${base}/active?limit=999`)).status).toBe(400);
    await service.markEnded('tienda', '7450012345678901234');
    expect(
      ((await (await fetch(`${base}/active`)).json()) as any).data,
    ).toEqual([]);
    expect(
      (await db.store.findUnique({ where: { id: 'local-store' } })).isLiveNow,
    ).toBe(false);
  });
});
