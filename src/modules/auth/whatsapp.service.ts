import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { SettingsService, WhatsAppSettings } from '../settings/settings.service';

export interface WhatsAppStatus {
  driver: WhatsAppSettings['driver'];
  configured: boolean;
  connected: boolean;
  detail: string;
}

export interface SendResult {
  /** True when the message really went to WhatsApp. */
  delivered: boolean;
  /** Only the LOG driver outside production: lets developers read the code without a phone. */
  devOnly?: boolean;
}

/**
 * Sends WhatsApp texts through a self-hosted open source gateway:
 *  - WAHA (https://github.com/devlikeapro/waha): POST /api/sendText
 *  - Evolution API (https://github.com/EvolutionAPI/evolution-api): POST /message/sendText/{instance}
 * Both link a normal WhatsApp number by scanning a QR once; nothing here talks to WhatsApp directly.
 * The LOG driver prints the message instead, for local development.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly settings: SettingsService) {}

  async send(phone: string, text: string): Promise<SendResult> {
    const cfg = await this.settings.getWhatsApp();
    const digits = phone.replace(/\D/g, '');

    if (cfg.driver === 'LOG') {
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException('El envío por WhatsApp todavía no está configurado. Avisa al administrador.');
      }
      this.logger.warn(`[WhatsApp LOG → +${digits}] ${text}`);
      return { delivered: false, devOnly: true };
    }
    if (!cfg.baseUrl) throw new ServiceUnavailableException('El envío por WhatsApp todavía no está configurado. Avisa al administrador.');

    try {
      const res =
        cfg.driver === 'WAHA'
          ? await fetch(`${cfg.baseUrl}/api/sendText`, {
              method: 'POST',
              headers: this.headers(cfg, 'X-Api-Key'),
              body: JSON.stringify({ session: cfg.session, chatId: `${digits}@c.us`, text }),
              signal: AbortSignal.timeout(10_000),
            })
          : await fetch(`${cfg.baseUrl}/message/sendText/${encodeURIComponent(cfg.session)}`, {
              method: 'POST',
              headers: this.headers(cfg, 'apikey'),
              body: JSON.stringify({ number: digits, text }),
              signal: AbortSignal.timeout(10_000),
            });
      if (!res.ok) {
        this.logger.error(`${cfg.driver} respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
        throw new Error(`HTTP ${res.status}`);
      }
      return { delivered: true };
    } catch (err) {
      this.logger.error(`No se pudo enviar el WhatsApp a +${digits}: ${(err as Error).message}`);
      throw new ServiceUnavailableException('No pudimos enviarte el código por WhatsApp. Inténtalo en unos minutos.');
    }
  }

  async status(): Promise<WhatsAppStatus> {
    const cfg = await this.settings.getWhatsApp();
    if (cfg.driver === 'LOG') {
      return { driver: 'LOG', configured: false, connected: false, detail: 'Modo de prueba: los códigos se escriben en el registro del servidor, no se envían.' };
    }
    if (!cfg.baseUrl) return { driver: cfg.driver, configured: false, connected: false, detail: 'Falta la dirección del servidor de WhatsApp.' };

    try {
      const url =
        cfg.driver === 'WAHA'
          ? `${cfg.baseUrl}/api/sessions/${encodeURIComponent(cfg.session)}`
          : `${cfg.baseUrl}/instance/connectionState/${encodeURIComponent(cfg.session)}`;
      const res = await fetch(url, { headers: this.headers(cfg, cfg.driver === 'WAHA' ? 'X-Api-Key' : 'apikey'), signal: AbortSignal.timeout(6_000) });
      if (!res.ok) return { driver: cfg.driver, configured: true, connected: false, detail: `El servidor respondió ${res.status}. Revisa la clave y el nombre de la sesión.` };
      const body = (await res.json()) as { status?: string; instance?: { state?: string }; state?: string };
      const state = String(body.status ?? body.instance?.state ?? body.state ?? '').toUpperCase();
      const connected = state === 'WORKING' || state === 'OPEN';
      return {
        driver: cfg.driver,
        configured: true,
        connected,
        detail: connected ? 'WhatsApp vinculado y listo para enviar.' : `Sesión sin vincular (${state || 'sin estado'}). Escanea el QR en el panel de ${cfg.driver === 'WAHA' ? 'WAHA' : 'Evolution API'}.`,
      };
    } catch (err) {
      return { driver: cfg.driver, configured: true, connected: false, detail: `No se pudo contactar al servidor: ${(err as Error).message}` };
    }
  }

  private headers(cfg: WhatsAppSettings, keyHeader: string): Record<string, string> {
    return { 'Content-Type': 'application/json', ...(cfg.apiKey ? { [keyHeader]: cfg.apiKey } : {}) };
  }
}
