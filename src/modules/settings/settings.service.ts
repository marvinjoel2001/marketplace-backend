import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

export interface ShippingRates {
  baseFare: number;
  perKm: number;
  minDistanceKm: number;
}

export const DEFAULT_SHIPPING: ShippingRates = { baseFare: 8, perKm: 2.5, minDistanceKm: 1.2 };

export type WhatsAppDriver = 'LOG' | 'WAHA' | 'EVOLUTION';

export interface WhatsAppSettings {
  driver: WhatsAppDriver;
  baseUrl: string;
  apiKey: string;
  /** WAHA session name or Evolution instance name. */
  session: string;
}

const KEYS = { shipping: 'shipping', whatsapp: 'whatsapp', secret: 'token_secret', notificationsSeen: 'admin_notifications_seen_at' } as const;

/** Platform-wide settings kept in the AppSetting table, with env fallbacks where an operator would set them at deploy time. */
@Injectable()
export class SettingsService {
  private secretCache?: string;

  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string): Promise<T | null> {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    const json = JSON.stringify(value);
    await this.prisma.appSetting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
  }

  async getShipping(): Promise<ShippingRates> {
    const saved = await this.get<Partial<ShippingRates>>(KEYS.shipping);
    return { ...DEFAULT_SHIPPING, ...(saved ?? {}) };
  }

  async setShipping(input: Partial<ShippingRates>): Promise<ShippingRates> {
    const current = await this.getShipping();
    const next: ShippingRates = {
      baseFare: nonNegative(input.baseFare, current.baseFare),
      perKm: nonNegative(input.perKm, current.perKm),
      minDistanceKm: nonNegative(input.minDistanceKm, current.minDistanceKm),
    };
    await this.set(KEYS.shipping, next);
    return next;
  }

  async getWhatsApp(): Promise<WhatsAppSettings> {
    const saved = (await this.get<Partial<WhatsAppSettings>>(KEYS.whatsapp)) ?? {};
    const envDriver = (process.env.WHATSAPP_DRIVER || '').toUpperCase();
    return {
      driver: (saved.driver ?? (isDriver(envDriver) ? envDriver : 'LOG')) as WhatsAppDriver,
      baseUrl: (saved.baseUrl ?? process.env.WHATSAPP_API_URL ?? '').replace(/\/+$/, ''),
      apiKey: saved.apiKey ?? process.env.WHATSAPP_API_KEY ?? '',
      session: saved.session ?? process.env.WHATSAPP_SESSION ?? 'default',
    };
  }

  async setWhatsApp(input: Partial<WhatsAppSettings>): Promise<WhatsAppSettings> {
    const current = await this.getWhatsApp();
    const next: WhatsAppSettings = {
      driver: isDriver(String(input.driver)) ? (input.driver as WhatsAppDriver) : current.driver,
      baseUrl: (input.baseUrl ?? current.baseUrl).trim().replace(/\/+$/, ''),
      // An empty key from the form means "keep the one already saved".
      apiKey: input.apiKey ? input.apiKey.trim() : current.apiKey,
      session: (input.session ?? current.session).trim() || 'default',
    };
    await this.set(KEYS.whatsapp, next);
    return next;
  }

  /** Secret that signs admin tokens and hashes login codes. ADMIN_TOKEN_SECRET wins; otherwise one is generated once and persisted. */
  async getSecret(): Promise<string> {
    if (process.env.ADMIN_TOKEN_SECRET) return process.env.ADMIN_TOKEN_SECRET;
    if (this.secretCache) return this.secretCache;
    const saved = await this.get<string>(KEYS.secret);
    if (saved) return (this.secretCache = saved);
    const generated = randomBytes(32).toString('hex');
    await this.set(KEYS.secret, generated);
    return (this.secretCache = generated);
  }

  getNotificationsSeenAt() {
    return this.get<string>(KEYS.notificationsSeen);
  }

  markNotificationsSeen() {
    return this.set(KEYS.notificationsSeen, new Date().toISOString());
  }
}

function nonNegative(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : fallback;
}

function isDriver(value: string): value is WhatsAppDriver {
  return value === 'LOG' || value === 'WAHA' || value === 'EVOLUTION';
}
