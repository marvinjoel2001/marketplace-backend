import { Controller, Post, Get, Param, Body, BadRequestException, NotFoundException } from '@nestjs/common';
import { DspService } from './dsp.service';

@Controller('dsp')
export class DspController {
  constructor(private readonly dspService: DspService) {}

  @Post('quote')
  async getQuote(@Body() body: any) {
    const { pickupLat, pickupLng, dropoffLat, dropoffLng } = body;

    if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
      throw new BadRequestException('Coordenadas de recojo y entrega requeridas');
    }

    return this.dspService.getQuote({
      pickupLat: parseFloat(pickupLat),
      pickupLng: parseFloat(pickupLng),
      dropoffLat: parseFloat(dropoffLat),
      dropoffLng: parseFloat(dropoffLng),
      storeId: typeof body.storeId === 'string' ? body.storeId : undefined,
    });
  }

  @Get('track/:token')
  async getTracking(@Param('token') token: string) {
    const tracking = await this.dspService.getTracking(token);
    if (!tracking) throw new NotFoundException('Seguimiento no disponible por ahora');
    return tracking;
  }
}

