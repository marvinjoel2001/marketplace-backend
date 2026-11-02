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

/** Models the admin can pick for reading product photos; the first is the default. */
export const VISION_MODELS = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'deepseek-ai/deepseek-v4.1-flash-1017',
] as const;
export type VisionModel = (typeof VISION_MODELS)[number];

/** Who serves each model: Anthropic directly, or Deploy (deploy.com) through its OpenAI-compatible API. */
export type VisionProvider = 'anthropic' | 'deploy';
export const visionProvider = (model: VisionModel): VisionProvider => (model.startsWith('claude-') ? 'anthropic' : 'deploy');

/** Env var used until a key for that provider is saved from /admin. */
export const VISION_KEY_ENV: Record<VisionProvider, string> = { anthropic: 'ANTHROPIC_API_KEY', deploy: 'DEPLOY_API_KEY' };

export interface VisionAiSettings {
  enabled: boolean;
  model: VisionModel;
  provider: VisionProvider;
  /** Key of the selected model's provider. */
  apiKey: string;
  /** Every provider's key, so switching models never loses the other one. */
  keys: Record<VisionProvider, string>;
}

/** What is stored: Anthropic's key keeps its original field name. */
interface StoredVisionAi {
  enabled?: boolean;
  model?: string;
  apiKey?: string;
  deployApiKey?: string;
}

const KEYS = { shipping: 'shipping', whatsapp: 'whatsapp', visionAi: 'vision_ai', secret: 'token_secret', notificationsSeen: 'admin_notifications_seen_at' } as const;

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

  /** Model and keys that recognise product photos. ANTHROPIC_API_KEY / DEPLOY_API_KEY are used until a key is saved from /admin. */
  async getVisionAi(): Promise<VisionAiSettings> {
    const saved = (await this.get<StoredVisionAi>(KEYS.visionAi)) ?? {};
    const model = VISION_MODELS.includes(saved.model as VisionModel) ? (saved.model as VisionModel) : VISION_MODELS[0];
    const keys: Record<VisionProvider, string> = {
      anthropic: saved.apiKey || process.env.ANTHROPIC_API_KEY || '',
      deploy: saved.deployApiKey || process.env.DEPLOY_API_KEY || '',
    };
    const provider = visionProvider(model);
    return { enabled: saved.enabled ?? true, model, provider, apiKey: keys[provider], keys };
  }

  /** The key in the form (and removeKey) apply to the provider of the model being saved. */
  async setVisionAi(input: { enabled?: boolean; model?: string; apiKey?: string; removeKey?: boolean }): Promise<VisionAiSettings> {
    const saved = (await this.get<StoredVisionAi>(KEYS.visionAi)) ?? {};
    const model = VISION_MODELS.includes(input.model as VisionModel)
      ? (input.model as VisionModel)
      : VISION_MODELS.includes(saved.model as VisionModel) ? (saved.model as VisionModel) : VISION_MODELS[0];
    const field = visionProvider(model) === 'anthropic' ? 'apiKey' : 'deployApiKey';
    const next: StoredVisionAi = {
      ...saved,
      enabled: input.enabled === undefined ? saved.enabled ?? true : Boolean(input.enabled),
      model,
      // An empty key from the form means "keep the one already saved".
      [field]: input.removeKey ? '' : input.apiKey?.trim() || saved[field] || '',
    };
    await this.set(KEYS.visionAi, next);
    return this.getVisionAi();
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
