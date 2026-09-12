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

  @Get(':idOrSlug')
  async getOne(@Param('idOrSlug') idOrSlug: string) {
    return this.storesService.findBySlugOrId(idOrSlug);
  }

  @Post()
  async create(@Body() body: any) {
    return this.storesService.create(body);
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

  @Patch(':storeId/offers/:offerId/toggle')
  async toggleOffer(
    @Param('storeId') storeId: string,
    @Param('offerId') offerId: string,
  ) {
    return this.storesService.toggleOfferPromo(storeId, offerId);
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
