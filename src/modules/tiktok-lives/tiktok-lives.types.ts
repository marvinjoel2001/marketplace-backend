export const LIVE_TTL_SECONDS = 60;
// Freshness, temporary verification grace, and snapshot caching are separate.
export const LIVE_RETENTION_SECONDS = 300;
export const LIVE_CACHE_SECONDS = 15;
export const CATEGORIES = [
  'Ropa',
  'Accesorios',
  'Electrónica',
  'Hogar',
  'Belleza',
  'Juguetes',
  'Otros',
] as const;
export type LiveCategory = (typeof CATEGORIES)[number];

export interface LiveCandidate {
  username: string;
  roomId?: string;
  title: string;
  nickname?: string;
  bio?: string;
  viewerCount: number;
  avatarUrl?: string;
  coverImageUrl?: string;
  tags: string[];
  countryCode?: string;
  /** Signed, short-lived pull URLs from the room info, used for in-page previews. */
  streamHlsUrl?: string;
  streamFlvUrl?: string;
}

export interface ActiveLive {
  username: string;
  room_id: string;
  live_id: string;
  title: string;
  viewer_count: number;
  avatar_url: string | null;
  cover_image_url: string | null;
  stream_hls_url: string | null;
  stream_flv_url: string | null;
  tags: string[];
  category: string;
  is_selling: boolean;
  country_code: string;
  geo_evidence: string;
  source: string;
  store_id: string | null;
  verified_at: string;
  verification_status?: 'fresh' | 'refreshing';
  live_url: string;
  /** Derived from the title/username/geo evidence; a hint, like geo_evidence. */
  city: string | null;
  price_text: string | null;
  whatsapp_url: string | null;
  sales_score: number;
}

export function normalizeText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function normalizeUsername(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const username = input.trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_][a-z0-9_.]{0,23}$/.test(username) ? username : null;
}

export function imageUrl(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function viewerCount(input: unknown): number {
  const text = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  const match = text.match(/^(\d+(?:[.,]\d+)?)(k|m|mil)?$/);
  if (!match) return 0;
  const digits =
    !match[2] && /^\d{1,3}[.,]\d{3}$/.test(match[1])
      ? match[1].replace(/[.,]/g, '')
      : match[1].replace(',', '.');
  const number = Number(digits);
  return Math.min(
    2147483647,
    Math.max(
      0,
      Math.round(number * (match[2] === 'm' ? 1e6 : match[2] ? 1e3 : 1)),
    ),
  );
}

export class TikTokBlockedError extends Error {
  constructor() {
    super('TikTok requiere verificación o ha limitado el acceso');
  }
}

/** Gates failures across cron ticks; no immediate loops or CAPTCHA solving. */
export class RetryGate {
  constructor(private readonly initialWait = 30000, private readonly maxWait = 900000) {}
  private readonly failures = new Map<
    string,
    { attempts: number; next: number }
  >();
  ready(key: string, now = Date.now()): boolean {
    return (this.failures.get(key)?.next ?? 0) <= now;
  }
  success(key: string): void {
    this.failures.delete(key);
  }
  fail(key: string, now = Date.now()): number {
    const attempts = Math.min(10, (this.failures.get(key)?.attempts ?? 0) + 1);
    const wait =
      Math.min(this.maxWait, this.initialWait * 2 ** (attempts - 1)) +
      Math.floor(Math.random() * 5000);
    if (this.failures.size >= 2000)
      this.failures.delete(this.failures.keys().next().value);
    this.failures.set(key, { attempts, next: now + wait });
    return wait;
  }
}
