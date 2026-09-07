import { Controller, Get, Post, Patch, Param, Query, Body } from '@nestjs/common';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  async getAll(@Query('limit') limit?: string) {
    return this.ordersService.findAll(limit ? parseInt(limit, 10) : 20);
  }

  @Get(':idOrNumber')
  async getOne(@Param('idOrNumber') idOrNumber: string) {
    return this.ordersService.findByIdOrNumber(idOrNumber);
  }

  @Post()
  async create(@Body() body: any) {
    return this.ordersService.create(body);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    return this.ordersService.updateStatus(id, status);
  }

  @Post('webhook/dsp')
  async handleDspWebhook(@Body() payload: any) {
    return this.ordersService.handleDspWebhook(payload);
  }
}

