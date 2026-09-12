import { Controller, Get, Post, Query, Body, Param } from '@nestjs/common';
import { LiveStreamsService } from './live-streams.service';

@Controller('live-streams')
export class LiveStreamsController {
  constructor(private readonly liveStreamsService: LiveStreamsService) {}

  @Get()
  async getAll(@Query('storeId') storeId?: string) {
    return this.liveStreamsService.findAll(storeId);
  }

  @Post()
  async create(@Body() body: any) {
    return this.liveStreamsService.create(body);
  }

  @Post(':id/start')
  async start(@Param('id') id: string) {
    return this.liveStreamsService.startLive(id);
  }

  @Post(':id/end')
  async end(@Param('id') id: string) {
    return this.liveStreamsService.endLive(id);
  }

  @Post(':id/feature')
  async feature(@Param('id') id: string, @Body('productId') productId: string) {
    return this.liveStreamsService.featureProduct(id, productId);
  }
}
