import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';

@Injectable()
export class TikTokLivesConfig {
  constructor(private readonly env: ConfigService) {}
  get enabled(): boolean {
    return this.env.get('TIKTOK_LIVES_ENABLED') === 'true';
  }
  get runOnStartup(): boolean {
    return this.env.get('TIKTOK_RUN_ON_STARTUP') !== 'false';
  }
  get redisUrl(): string | undefined {
    return this.env.get('TIKTOK_REDIS_URL');
  }
  get adminKey(): string | undefined {
    return this.env.get('TIKTOK_ADMIN_KEY');
  }
  get browserPath(): string | undefined {
    return this.env.get('PUPPETEER_EXECUTABLE_PATH');
  }
  get headless(): boolean {
    return this.env.get('TIKTOK_HEADLESS') !== 'false';
  }
  /** Persistent Chromium profile that keeps the operator's TikTok session between cycles. Never commit it. */
  get profileDir(): string {
    return resolve(this.env.get<string>('TIKTOK_PROFILE_DIR', '.tiktok-profile'));
  }
  /** Allows opening a visible sign-in window on this machine; only for the operator's own computer. */
  get interactiveLogin(): boolean {
    return this.env.get('TIKTOK_INTERACTIVE_LOGIN') === 'true';
  }
  get signApiKey(): string | undefined {
    return this.env.get('TIKTOK_SIGN_API_KEY');
  }
  get country(): string {
    return this.env.get<string>('TIKTOK_COUNTRY_CODE', 'BO').toUpperCase();
  }
  get regionTerms(): string[] {
    return this.env
      .get<string>(
        'TIKTOK_REGION_TERMS',
        'bolivia,scz,santa cruz,la paz,cochabamba,el alto,tarija,sucre,oruro,potosi,beni,pando',
      )
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  }
  /** When false, selling lives without regional evidence are listed too (explicit foreign countries stay out). */
  get requireRegion(): boolean {
    return this.env.get('TIKTOK_REQUIRE_REGION') === 'true';
  }
  /** Keywords explored through TikTok's LIVE search, besides the /live recommendations feed. */
  get searchTerms(): string[] {
    return this.env
      .get<string>(
        'TIKTOK_SEARCH_TERMS',
        'venta de ropa,remate de ropa,ofertas en vivo,tienda bolivia',
      )
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 40);
  }
  /** Search terms explored per cycle; the rest rotate in on later cycles to keep each one short. */
  get searchTermsPerCycle(): number {
    return this.integer('TIKTOK_SEARCH_TERMS_PER_CYCLE', 4, 1, 40);
  }
  /** Live sellers whose rooms are visited per discovery cycle to collect related LIVEs (0 disables). */
  get snowballPerCycle(): number {
    return this.integer('TIKTOK_SNOWBALL_PER_CYCLE', 3, 0, 20);
  }
  /** Previously listed sellers re-probed per 3-minute cycle to catch them going live again (0 disables). */
  get recheckPerCycle(): number {
    return this.integer('TIKTOK_RECHECK_PER_CYCLE', 15, 0, 300);
  }
  /** Concurrent HTTP verifications; more lives need more to re-verify within the freshness window. */
  get verifyConcurrency(): number {
    return this.integer('TIKTOK_VERIFY_CONCURRENCY', 5, 1, 10);
  }
  get maxCandidates(): number {
    return this.integer('TIKTOK_MAX_CANDIDATES', 200, 1, 500);
  }
  get maxConnections(): number {
    return this.integer('TIKTOK_MAX_CONNECTIONS', 10, 0, 50);
  }
  get scrolls(): number {
    return this.integer('TIKTOK_SCROLL_STEPS', 20, 1, 30);
  }
  get proxy(): URL | undefined {
    const raw = this.env.get<string>('TIKTOK_PROXY_URL');
    if (!raw) return undefined;
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('TIKTOK_PROXY_URL debe usar HTTP(S)');
    return url;
  }
  private integer(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const raw = this.env.get<string>(key);
    const n = raw === undefined ? fallback : Number(raw);
    if (!Number.isInteger(n) || n < min || n > max)
      throw new Error(`${key} debe estar entre ${min} y ${max}`);
    return n;
  }
}
