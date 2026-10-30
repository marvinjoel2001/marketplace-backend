import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Put,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { TikTokLivesConfig } from './tiktok-lives.config';
import { TikTokLivesService } from './tiktok-lives.service';
import { LiveFeedService } from './live-feed.service';

@Controller('tiktok-lives')
export class TikTokLivesController {
  constructor(
    private readonly lives: TikTokLivesService,
    private readonly config: TikTokLivesConfig,
    private readonly feeds: LiveFeedService,
  ) {}

  @Get('active')
  active(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('category') category?: string,
    @Query('city') city?: string,
  ) {
    return this.lives.active({ page, limit, category, city });
  }

  /** Live room: the seller's live, its Vitrina products and what is happening in the chat. */
  @Get('room/:username')
  async room(@Param('username') username: string) {
    const room = await this.lives.room(username);
    const feed = room.live && room.isLive ? this.feeds.snapshot(room.username, room.live.room_id) : null;
    return { ...room, feed };
  }

  /** New comments since `after`, plus current likes, viewers, pinned messages and products. */
  @Get('room/:username/feed')
  async feed(@Param('username') username: string, @Query('after') after?: string) {
    const room = await this.lives.room(username);
    if (!room.live || !room.isLive) return { status: 'ended', viewers: null, likes: null, shares: 0, comments: [], pins: [], products: [] };
    return this.feeds.snapshot(room.username, room.live.room_id, after);
  }

  @Put('stores/:storeId/account')
  register(
    @Param('storeId') storeId: string,
    @Body('tiktok_username') username: unknown,
    @Headers('x-tiktok-admin-key') provided?: string,
  ) {
    const key = this.config.adminKey;
    if (!key || key.length < 32)
      throw new ServiceUnavailableException(
        'Configura TIKTOK_ADMIN_KEY (mínimo 32 caracteres) para registrar cuentas',
      );
    const expected = Buffer.from(key);
    const actual = Buffer.from(provided ?? '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new ForbiddenException('Credencial administrativa inválida');
    return this.lives.register(storeId, username);
  }
}
