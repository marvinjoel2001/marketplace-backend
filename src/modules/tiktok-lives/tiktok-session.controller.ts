import { Controller, ForbiddenException, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TikTokDiscoveryService } from './tiktok-discovery.service';
import { TikTokLivesConfig } from './tiktok-lives.config';
import { TikTokLivesWorker } from './tiktok-lives.worker';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The operator's TikTok session. It belongs to whoever runs the backend, not to marketplace
 * visitors: discovery reads that account's recommended LIVE feed and filters it to sellers.
 */
@Controller('tiktok-lives/session')
export class TikTokSessionController {
  constructor(
    private readonly discovery: TikTokDiscoveryService,
    private readonly worker: TikTokLivesWorker,
    private readonly config: TikTokLivesConfig,
  ) {}

  @Get()
  async status() {
    return {
      ...(await this.discovery.sessionStatus()),
      interactive_login: this.config.interactiveLogin,
      worker_enabled: this.config.enabled,
    };
  }

  /** Opens a visible sign-in window on the backend's machine, so only that machine may ask for it. */
  @Post('login')
  @HttpCode(202)
  async login(@Req() request: Request) {
    if (!this.config.interactiveLogin)
      throw new ForbiddenException(
        'Inicio de sesión de TikTok desactivado: define TIKTOK_INTERACTIVE_LOGIN=true en el equipo del operador',
      );
    if (!LOOPBACK.has(request.socket.remoteAddress ?? ''))
      throw new ForbiddenException('El inicio de sesión de TikTok solo se abre desde este mismo equipo');
    this.worker.startLogin();
    return this.status();
  }
}
