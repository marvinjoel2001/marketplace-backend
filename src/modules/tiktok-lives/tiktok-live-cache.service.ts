import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { TikTokLivesConfig } from './tiktok-lives.config';
import { ActiveLive, LIVE_CACHE_SECONDS } from './tiktok-lives.types';

const KEY = 'vitrina:tiktok:v1:active';
const GENERATION = 'vitrina:tiktok:v1:generation';

@Injectable()
export class TikTokLiveCache implements OnModuleDestroy {
  private readonly logger = new Logger(TikTokLiveCache.name);
  private readonly redis?: Redis;
  private memory?: { expires: number; lives: ActiveLive[] };
  private generation = 0;
  private readonly running = new Set<string>();
  private errorLogged = false;

  constructor(config: TikTokLivesConfig) {
    if (config.redisUrl) {
      this.redis = new Redis(config.redisUrl, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        commandTimeout: 2000,
        retryStrategy: (times) => Math.min(times * 1000, 30000),
      });
      this.redis.on('error', () => {
        if (!this.errorLogged)
          this.logger.warn(
            'Redis TikTok no disponible; API consulta DB, workers esperan reconexión',
          );
        this.errorLogged = true;
      });
      this.redis.on('ready', () => {
        this.errorLogged = false;
      });
      void this.redis.connect().catch(() => undefined);
    } else {
      this.logger.warn(
        'TIKTOK_REDIS_URL ausente: caché en memoria, solo una instancia del worker',
      );
    }
  }

  get backend(): 'redis' | 'database' | 'memory' {
    return this.redis
      ? this.redis.status === 'ready'
        ? 'redis'
        : 'database'
      : 'memory';
  }
  async version(): Promise<string | null> {
    if (!this.redis) return String(this.generation);
    try {
      return (await this.redis.get(GENERATION)) ?? '0';
    } catch {
      return null;
    }
  }
  async read(): Promise<ActiveLive[] | null> {
    if (!this.redis)
      return this.memory && this.memory.expires > Date.now()
        ? this.memory.lives
        : null;
    try {
      const raw = await this.redis.get(KEY);
      if (!raw) return null;
      const lives = JSON.parse(raw);
      return Array.isArray(lives) ? lives : null;
    } catch {
      return null;
    }
  }
  async write(lives: ActiveLive[], version: string | null): Promise<void> {
    if (version === null) return;
    if (!this.redis) {
      if (String(this.generation) === version)
        this.memory = { expires: Date.now() + LIVE_CACHE_SECONDS * 1000, lives };
      return;
    }
    // Don't resurrect a snapshot read before a stream-end/cache invalidation event.
    await this.redis
      .eval(
        "if (redis.call('get', KEYS[2]) or '0') == ARGV[1] then return redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3]) end return nil",
        2,
        KEY,
        GENERATION,
        version,
        JSON.stringify(lives),
        LIVE_CACHE_SECONDS,
      )
      .catch(() => undefined);
  }
  async invalidate(): Promise<void> {
    this.memory = undefined;
    this.generation++;
    if (this.redis)
      await this.redis
        .multi()
        .incr(GENERATION)
        .del(KEY)
        .exec()
        .catch(() => undefined);
  }

  /** A renewable lease prevents duplicate jobs across replicas. Fail closed when Redis is down. */
  async withLease(
    name: string,
    job: (ownsLease: () => boolean) => Promise<void>,
  ): Promise<void> {
    if (this.running.has(name)) return;
    this.running.add(name);
    const key = `vitrina:tiktok:v1:lock:${name}`;
    const token = randomUUID();
    let owned = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      owned = this.redis
        ? (await this.redis.set(key, token, 'EX', 90, 'NX')) === 'OK'
        : true;
      if (!owned) return;
      if (this.redis) {
        heartbeat = setInterval(() => {
          void this.redis
            .eval(
              "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], 90) end return 0",
              1,
              key,
              token,
            )
            .then((result) => {
              if (Number(result) !== 1) owned = false;
            })
            .catch(() => {
              owned = false;
            });
        }, 20000);
        heartbeat.unref();
      }
      await job(() => owned);
    } catch {
      this.logger.warn(
        `Tarea TikTok ${name} interrumpida; se reintentará en el próximo ciclo`,
      );
    } finally {
      owned = false;
      if (heartbeat) clearInterval(heartbeat);
      if (this.redis)
        await this.redis
          .eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
            1,
            key,
            token,
          )
          .catch(() => undefined);
      this.running.delete(name);
    }
  }
  async onModuleDestroy(): Promise<void> {
    this.redis?.disconnect();
  }
}
