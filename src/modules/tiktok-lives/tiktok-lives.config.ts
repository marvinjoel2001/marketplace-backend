import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TikTokLivesConfig {
  constructor(private readonly env: ConfigService) {}
  get enabled(): boolean {
    return this.env.get('TIKTOK_LIVES_ENABLED') === 'true';
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
  get maxCandidates(): number {
    return this.integer('TIKTOK_MAX_CANDIDATES', 40, 1, 200);
  }
  get maxConnections(): number {
    return this.integer('TIKTOK_MAX_CONNECTIONS', 10, 0, 50);
  }
  get scrolls(): number {
    return this.integer('TIKTOK_SCROLL_STEPS', 8, 1, 30);
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
