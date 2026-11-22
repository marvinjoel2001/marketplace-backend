import { Controller, Get, Post, Query, Body, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { LiveStreamsService } from './live-streams.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, SessionUser, UserGuard, ownedStore } from '../auth/user.guard';
import { TikTokLivesService } from '../tiktok-lives/tiktok-lives.service';
import { TikTokLivesWorker } from '../tiktok-lives/tiktok-lives.worker';

@Controller('live-streams')
export class LiveStreamsController {
  constructor(
    private readonly liveStreamsService: LiveStreamsService,
    private readonly prisma: PrismaService,
    private readonly tiktokLives: TikTokLivesService,
    private readonly tiktokWorker: TikTokLivesWorker,
  ) {}

  @Get()
  async getAll(@Query('storeId') storeId?: string) {
    return this.liveStreamsService.findAll(storeId);
  }

  @Post()
  @UseGuards(UserGuard)
  async create(@Body() body: any, @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, String(body?.storeId ?? ''), user.id);
    // The reviewer only looks for linked accounts: link the username the seller typed before
    // opening the sale (fails early if another store already uses it), then look for the live now.
    await this.tiktokLives.linkStoreAccount(store.id);
    const stream = await this.liveStreamsService.create({ ...body, storeId: store.id });
    this.tiktokWorker.checkStore(store.id);
    return stream;
  }

  @Post(':id/start')
  @UseGuards(UserGuard)
  async start(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    await this.ownStream(id, user.id);
    return this.liveStreamsService.startLive(id);
  }

  @Post(':id/end')
  @UseGuards(UserGuard)
  async end(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    await this.ownStream(id, user.id);
    return this.liveStreamsService.endLive(id);
  }

  @Post(':id/feature')
  @UseGuards(UserGuard)
  async feature(@Param('id') id: string, @Body('productId') productId: string, @CurrentUser() user: SessionUser) {
    await this.ownStream(id, user.id);
    return this.liveStreamsService.featureProduct(id, productId);
  }

  private async ownStream(id: string, userId: string) {
    const stream = await this.prisma.liveStream.findUnique({ where: { id }, select: { storeId: true } });
    if (!stream) throw new NotFoundException('Transmisión no encontrada');
    await ownedStore(this.prisma, stream.storeId, userId);
  }
}
