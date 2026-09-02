import { Controller, Get, Post, Query, Body } from '@nestjs/common';
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
}
