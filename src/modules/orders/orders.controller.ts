import { Controller, Get, Post, Param, Body, Headers, Logger, UseGuards, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { OrdersService, CreateOrderDto, DspWebhookPayload } from './orders.service';
import { CurrentUser, SessionUser, UserGuard } from '../auth/user.guard';

@Controller('orders')
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name);
  private warnedWebhook = false;

  constructor(private readonly ordersService: OrdersService) {}

  @Get('mine')
  @UseGuards(UserGuard)
  async getMine(@CurrentUser() user: SessionUser) {
    return this.ordersService.findByUser(user.id);
  }

  @Get(':idOrNumber')
  @UseGuards(UserGuard)
  async getOne(@Param('idOrNumber') idOrNumber: string, @CurrentUser() user: SessionUser) {
    return this.ordersService.findForViewer(idOrNumber, user.id);
  }

  @Post()
  @UseGuards(UserGuard)
  async create(@Body() body: CreateOrderDto, @CurrentUser() user: SessionUser) {
    return this.ordersService.create({ ...body, userId: user.id });
  }

  /**
   * OpenDSP posts status changes here, signed with the tenant's webhook secret (HMAC-SHA256 of the JSON body, hex, in
   * X-DSP-Signature). Register `<backend>/api/v1/orders/webhook/dsp` as the tenant's webhookUrl in OpenDSP.
   */
  @Post('webhook/dsp')
  async handleDspWebhook(@Body() payload: DspWebhookPayload, @Headers('x-dsp-signature') signature?: string) {
    if (!this.validSignature(payload, signature)) throw new UnauthorizedException('Firma del webhook inválida');
    return this.ordersService.handleDspWebhook(payload);
  }

  private validSignature(payload: unknown, signature?: string) {
    const secret = process.env.DSP_WEBHOOK_SECRET;
    if (!secret) {
      if (!this.warnedWebhook) this.logger.warn('DSP_WEBHOOK_SECRET no está definida: los webhooks de OpenDSP se rechazan en producción.');
      this.warnedWebhook = true;
      return process.env.NODE_ENV !== 'production';
    }
    const expected = Buffer.from(createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex'));
    const given = Buffer.from(String(signature ?? ''));
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}
