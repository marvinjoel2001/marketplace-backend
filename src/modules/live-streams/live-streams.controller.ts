import { Controller, Get, Post, Query, Body, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { LiveStreamsService } from './live-streams.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, SessionUser, UserGuard, ownedStore } from '../auth/user.guard';

@Controller('live-streams')
export class LiveStreamsController {
  constructor(
    private readonly liveStreamsService: LiveStreamsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async getAll(@Query('storeId') storeId?: string) {
    return this.liveStreamsService.findAll(storeId);
  }

  @Post()
  @UseGuards(UserGuard)
  async create(@Body() body: any, @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, String(body?.storeId ?? ''), user.id);
    return this.liveStreamsService.create({ ...body, storeId: store.id });
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
