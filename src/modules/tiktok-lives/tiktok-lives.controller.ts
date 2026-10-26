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

@Controller('tiktok-lives')
export class TikTokLivesController {
  constructor(
    private readonly lives: TikTokLivesService,
    private readonly config: TikTokLivesConfig,
  ) {}

  @Get('active')
  active(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('category') category?: string,
  ) {
    return this.lives.active({ page, limit, category });
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
