import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';
import type {
  TikTokLiveConnection,
  TikTokLiveConstructorConnectionOptions,
} from 'tiktok-live-connector';
import { TikTokLivesConfig } from './tiktok-lives.config';
import { TikTokLivesService } from './tiktok-lives.service';
import { LiveCandidate, normalizeUsername, RetryGate } from './tiktok-lives.types';
import { parseRooms } from './tiktok-payload.parser';

// Preserve native ESM import when compiling this NestJS project to CommonJS (Node >=20).
const loadConnector = new Function(
  'return import("tiktok-live-connector")',
) as () => Promise<typeof import('tiktok-live-connector')>;

@Injectable()
export class TikTokConnectorService implements OnModuleDestroy {
  private readonly logger = new Logger(TikTokConnectorService.name);
  private readonly connections = new Map<
    string,
    { connection: TikTokLiveConnection; roomId: string; viewerWriteAt: number }
  >();
  private readonly retry = new RetryGate();
  private stopping = false;
  private sdk?: Promise<typeof import('tiktok-live-connector')>;
  private httpsAgent?: HttpsProxyAgent<string>;
  private httpAgent?: HttpProxyAgent<string>;
  constructor(
    private readonly config: TikTokLivesConfig,
    private readonly lives: TikTokLivesService,
  ) {}

  private library() {
    return (this.sdk ??= loadConnector());
  }
  private async create(username: string): Promise<TikTokLiveConnection> {
    const { TikTokLiveConnection, getRandomPresets } = await this.library();
    const proxy = this.config.proxy;
    if (proxy) {
      this.httpsAgent ??= new HttpsProxyAgent(proxy);
      this.httpAgent ??= new HttpProxyAgent(proxy);
    }
    return new TikTokLiveConnection(username, {
      clientPresets: {
        ...getRandomPresets(),
        location: {
          lang: 'es',
          lang_country: 'es-BO',
          country: this.config.country,
          tz_name: 'America/La_Paz',
        },
      },
      processInitialData: false,
      fetchRoomInfoOnConnect: true,
      enableExtendedGiftInfo: false,
      signApiKey: this.config.signApiKey,
      webClientOptions: {
        timeout: { request: 10000 },
        retry: { limit: 0 },
        headers: { 'accept-language': 'es-BO,es;q=0.9' },
        ...(proxy
          ? { agent: { https: this.httpsAgent, http: this.httpAgent } }
          : {}),
        // The connector constructs its cookie jar internally; its input type requires it unnecessarily.
      } as unknown as TikTokLiveConstructorConnectionOptions['webClientOptions'],
      wsClientOptions: {
        handshakeTimeout: 10000,
        ...(proxy ? { agent: this.httpsAgent } : {}),
      },
    });
  }

  /** Public HTML, then API-live when HTML is missing or has changed; no signing provider needed. */
  async probe(username: string, roomId?: string): Promise<{ live: LiveCandidate | null }> {
    const clean = normalizeUsername(username);
    if (!clean) throw new Error('Username TikTok inválido');
    const sdk = await this.library();
    const connection = await this.create(clean);
    if (roomId && /^\d{5,30}$/.test(roomId)) {
      // Known rooms can be verified in one request to webcast. The profile
      // HTML/API-live endpoints frequently return 403 even for active rooms.
      const raw = await sdk.RouteConfig.fetchRoomInfo({
        webClient: connection.webClient, roomId,
      });
      const empty = raw === undefined || raw === null ||
        (typeof raw === 'string' && raw.trim() === '') ||
        (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0);
      if (!empty) {
        const result = this.probeResult(raw, clean);
        if (result.live && result.live.roomId !== roomId)
          throw new Error('TikTok devolvió una sala distinta a la solicitada');
        return result;
      }
      // The SDK can return an empty string/envelope from webcast even while
      // the public profile route still verifies this seller. Fall through to
      // that route; explicit HTTP blocks and offline states keep their meaning.
    }
    const args = { webClient: connection.webClient, uniqueId: clean };
    try {
      const raw = await sdk.RouteConfig.fetchRoomInfoFromHtml(args);
      return this.probeResult(raw, clean);
    } catch {
      // A successful HTTP response may still omit SIGI_STATE. Use the public
      // API route that TikTok itself uses, without requiring Euler credentials.
      const raw = await sdk.RouteConfig.fetchRoomInfoFromApiLive(args);
      return this.probeResult(raw, clean);
    }
  }

  private probeResult(raw: any, username: string): { live: LiveCandidate | null } {
    const info =
      raw?.liveRoomUserInfo ?? raw?.data?.liveRoomUserInfo ?? raw?.data ?? raw;
    const room = info?.liveRoom ?? (info?.owner ? info : undefined);
    const status =
      room?.status === undefined
        ? undefined
        : Number(room.status);
    if (
      status === 4 ||
      status === 0 ||
      (info?.user && String(info.user.roomId) === '0')
    )
      return { live: null };
    const live = parseRooms(info).find((room) => room.username === username);
    if (!live || Number(status) !== 2)
      throw new Error(
        'Respuesta TikTok sin estado verificable (posible bloqueo o cambio de formato)',
      );
    return { live };
  }

  async watch(live: LiveCandidate): Promise<void> {
    if (this.stopping || !live.roomId || this.config.maxConnections === 0)
      return;
    const current = this.connections.get(live.username);
    if (current?.roomId === live.roomId) return;
    if (current) await this.unwatch(live.username);
    if (
      this.connections.size >= this.config.maxConnections ||
      !this.retry.ready(live.username)
    )
      return;
    const sdk = await this.library();
    const connection = await this.create(live.username);
    // Recheck after async creation: concurrent reservations must obey the socket cap.
    if (
      this.stopping ||
      this.connections.has(live.username) ||
      this.connections.size >= this.config.maxConnections
    )
      return;
    const entry = { connection, roomId: live.roomId, viewerWriteAt: 0 };
    this.connections.set(live.username, entry); // Reserve slot before awaiting connect.
    const safe = (task: Promise<unknown>) => {
      void task.catch(() =>
        this.logger.warn('No se pudo actualizar el estado de una sala TikTok'),
      );
    };
    const ended = () => {
      if (this.connections.get(live.username) !== entry) return;
      this.connections.delete(live.username);
      safe(this.lives.markEnded(live.username, live.roomId));
      safe(connection.disconnect());
    };
    connection.on(sdk.ControlEvent.ERROR, () => {
      /* connect() rejects; don't log proxy/session secrets */
    });
    connection.on(sdk.ControlEvent.DISCONNECTED, () => {
      if (this.connections.get(live.username) !== entry) return;
      this.connections.delete(live.username);
      this.retry.fail(live.username);
      // Transport loss does not prove the broadcast ended. HTTP refresh remains
      // authoritative until TikTok explicitly reports offline or STREAM_END.
    });
    connection.on(sdk.WebcastEvent.STREAM_END, ended);
    connection.on(sdk.WebcastEvent.ROOM_USER, (message) => {
      if (
        Date.now() - entry.viewerWriteAt < 5000 ||
        this.connections.get(live.username) !== entry
      )
        return;
      entry.viewerWriteAt = Date.now();
      safe(this.lives.updateViewers(live.username, live.roomId, message.total));
    });
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        connection.connect(live.roomId).then(async () => {
          if (
            timedOut ||
            this.stopping ||
            this.connections.get(live.username) !== entry
          )
            await connection.disconnect();
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            timedOut = true;
            reject(new Error('Connect timeout'));
          }, 15000);
        }),
      ]);
      if (!timedOut && this.connections.get(live.username) === entry)
        this.retry.success(live.username);
    } catch {
      this.retry.fail(live.username);
      if (this.connections.get(live.username) === entry)
        this.connections.delete(live.username);
      await connection.disconnect().catch(() => undefined);
      this.logger.warn(
        'WebSocket TikTok no disponible; sala verificada por HTTP, próximo intento con backoff',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async unwatch(username: string): Promise<void> {
    const entry = this.connections.get(username);
    if (!entry) return;
    this.connections.delete(username);
    await entry.connection.disconnect().catch(() => undefined);
  }
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await Promise.allSettled(
      [...this.connections.keys()].map((username) => this.unwatch(username)),
    );
    this.httpsAgent?.destroy();
    this.httpAgent?.destroy();
  }
}
