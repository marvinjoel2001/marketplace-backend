import { Controller, Get, Post, Patch, Delete, Param, Query, Body } from '@nestjs/common';
import { StoresService } from './stores.service';

@Controller('stores')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get()
  async getAll(@Query('isLive') isLive?: string) {
    return this.storesService.findAll({ isLive: isLive === 'true' });
  }

  // Validación de cupones para checkout
  @Get('coupons/validate')
  async validateCoupon(
    @Query('code') code: string,
    @Query('storeId') storeId?: string,
    @Query('amount') amount?: string,
  ) {
    return this.storesService.validateCoupon(
      code,
      storeId,
      amount ? parseFloat(amount) : 0,
    );
  }

  // Tiendas registradas que están en vivo ahora
  @Get('live')
  async getLive() {
    return this.storesService.findLive();
  }

  @Get('owner/:userId')
  async getByOwner(@Param('userId') userId: string) {
    return this.storesService.findByOwner(userId);
  }

  @Get(':idOrSlug')
  async getOne(@Param('idOrSlug') idOrSlug: string) {
    return this.storesService.findBySlugOrId(idOrSlug);
  }

  @Post()
  async create(@Body() body: any) {
    return this.storesService.create(body);
  }

  @Patch(':idOrSlug')
  async update(@Param('idOrSlug') idOrSlug: string, @Body() body: Record<string, unknown>) {
    return this.storesService.update(idOrSlug, body ?? {});
  }

  // ==========================================
  // VENTAS Y MÉTRICAS
  // ==========================================
  @Get(':storeId/orders')
  async getOrders(@Param('storeId') storeId: string, @Query('since') since?: string) {
    return this.storesService.getOrders(storeId, since);
  }

  @Get(':storeId/summary')
  async getSummary(@Param('storeId') storeId: string) {
    return this.storesService.getSummary(storeId);
  }

  // ==========================================
  // OFERTAS Y PROMOCIONES DE LA TIENDA
  // ==========================================
  @Get(':storeId/offers')
  async getOffers(@Param('storeId') storeId: string) {
    return this.storesService.getOffers(storeId);
  }

  @Post(':storeId/offers/flash')
  async createFlashOffer(
    @Param('storeId') storeId: string,
    @Body() body: any,
  ) {
    return this.storesService.createOrUpdateFlashOffer(storeId, body);
  }

  @Post(':storeId/offers/bulk')
  async applyBulkOffer(@Param('storeId') storeId: string, @Body() body: any) {
    return this.storesService.applyBulkOffer(storeId, body ?? {});
  }

  @Post(':storeId/offers/end')
  async endOffers(@Param('storeId') storeId: string, @Body('offerIds') offerIds: string[]) {
    return this.storesService.endOffers(storeId, Array.isArray(offerIds) ? offerIds : []);
  }

  @Post(':storeId/offers/confirm')
  async confirmStock(@Param('storeId') storeId: string, @Body() body: { offerIds?: string[]; stillHave?: boolean }) {
    return this.storesService.confirmStock(storeId, body?.offerIds ?? [], body?.stillHave !== false);
  }

  @Post(':storeId/offers/:offerId/stock')
  async adjustStock(
    @Param('storeId') storeId: string,
    @Param('offerId') offerId: string,
    @Body() body: { change?: number; variant?: string },
  ) {
    return this.storesService.adjustStock(storeId, offerId, body ?? {});
  }

  @Patch(':storeId/offers/:offerId/toggle')
  async toggleOffer(
    @Param('storeId') storeId: string,
    @Param('offerId') offerId: string,
  ) {
    return this.storesService.toggleOfferPromo(storeId, offerId);
  }

  @Patch(':storeId/offers/:offerId')
  async updateOffer(
    @Param('storeId') storeId: string,
    @Param('offerId') offerId: string,
    @Body() body: any,
  ) {
    return this.storesService.updateOffer(storeId, offerId, body ?? {});
  }

  // ==========================================
  // CUPONES DE DESCUENTO DE LA TIENDA
  // ==========================================
  @Get(':storeId/coupons')
  async getCoupons(@Param('storeId') storeId: string) {
    return this.storesService.getCoupons(storeId);
  }

  @Post(':storeId/coupons')
  async createCoupon(
    @Param('storeId') storeId: string,
    @Body() body: any,
  ) {
    return this.storesService.createCoupon(storeId, body);
  }

  @Delete(':storeId/coupons/:couponId')
  async deleteCoupon(
    @Param('storeId') storeId: string,
    @Param('couponId') couponId: string,
  ) {
    return this.storesService.deleteCoupon(storeId, couponId);
  }
}
