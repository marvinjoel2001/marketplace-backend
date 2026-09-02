import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common';
import { StoresService } from './stores.service';

@Controller('stores')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get()
  async getAll(@Query('isLive') isLive?: string) {
    return this.storesService.findAll({ isLive: isLive === 'true' });
  }

  @Get(':idOrSlug')
  async getOne(@Param('idOrSlug') idOrSlug: string) {
    return this.storesService.findBySlugOrId(idOrSlug);
  }

  @Post()
  async create(@Body() body: any) {
    return this.storesService.create(body);
  }
}
