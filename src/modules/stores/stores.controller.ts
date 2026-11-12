import { Controller, Get, Post, Patch, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { StoresService } from './stores.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, SessionUser, UserGuard, ownedStore } from '../auth/user.guard';

@Controller('stores')
export class StoresController {
  constructor(
    private readonly storesService: StoresService,
    private readonly prisma: PrismaService,
  ) {}

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

  /** The signed-in seller's own store, with its payout details. */
  @Get('mine')
  @UseGuards(UserGuard)
  async getMine(@CurrentUser() user: SessionUser) {
    return this.storesService.findByOwner(user.id);
  }

  @Get(':idOrSlug')
  async getOne(@Param('idOrSlug') idOrSlug: string) {
    return this.storesService.findBySlugOrId(idOrSlug);
  }

  @Post()
  @UseGuards(UserGuard)
  async create(@Body() body: Record<string, unknown>, @CurrentUser() user: SessionUser) {
    return this.storesService.create({ ...(body ?? {}), ownerId: user.id } as never);
  }

  // Everything below is the seller panel: only the store's owner gets through.

  @Patch(':idOrSlug')
  @UseGuards(UserGuard)
  async update(@Param('idOrSlug') idOrSlug: string, @Body() body: Record<string, unknown>, @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, idOrSlug, user.id);
    return this.storesService.update(store.id, body ?? {});
  }

  // ==========================================
  // VENTAS Y MÉTRICAS
  // ==========================================
  @Get(':storeId/orders')
  @UseGuards(UserGuard)
  async getOrders(@Param('storeId') storeId: string, @CurrentUser() user: SessionUser, @Query('since') since?: string) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    return this.storesService.getOrders(store.id, since);
  }

  @Get(':storeId/summary')
  @UseGuards(UserGuard)
  async getSummary(@Param('storeId') storeId: string, @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    return this.storesService.getSummary(store.id);
  }

  // ==========================================
  // OFERTAS Y PROMOCIONES DE LA TIENDA
  // ==========================================
  @Get(':storeId/offers')
  @UseGuards(UserGuard)
  async getOffers(@Param('storeId') storeId: string, @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    return this.storesService.getOffers(store.id);
  }

  @Post(':storeId/offers/flash')
  @UseGuards(UserGuard)
  async createFlashOffer(@Param('storeId') storeId: string, @Body() body: any, @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    return this.storesService.createOrUpdateFlashOffer(store.id, body ?? {});
  }

  @Post(':storeId/offers/bulk')
  @UseGuards(UserGuard)
  async applyBulkOffer(@Param('storeId') storeId: string, @Body() body: any, @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    return this.storesService.applyBulkOffer(store.id, body ?? {});
  }

  @Post(':storeId/offers/end')
  @UseGuards(UserGuard)
  async endOffers(@Param('storeId') storeId: string, @Body('offerIds') offerIds: string[], @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    return this.storesService.endOffers(store.id, Array.isArray(offerIds) ? offerIds : []);
  }

  @Post(':storeId/offers/confirm')
  @UseGuards(UserGuard)
  async confirmStock(
    @Param('storeId') storeId: string,
    @Body() body: { offerIds?: string[]; stillHave?: boolean },
    @CurrentUser() user: SessionUser,
  ) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    return this.storesService.confirmStock(store.id, body?.offerIds ?? [], body?.stillHave !== false);
  }

  @Post(':storeId/offers/:offerId/stock')
  @UseGuards(UserGuard)
  async adjustStock(
    @Param('storeId') storeId: string,
    @Param('offerId') offerId: string,
    @Body() body: { change?: number; variant?: string },
    @CurrentUser() user: SessionUser,
  ) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    return this.storesService.adjustStock(store.id, offerId, body ?? {});
  }

  @Patch(':storeId/offers/:offerId/toggle')
  @UseGuards(UserGuard)
  async toggleOffer(@Param('storeId') storeId: string, @Param('offerId') offerId: string, @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    return this.storesService.toggleOfferPromo(store.id, offerId);
  }

  @Patch(':storeId/offers/:offerId')
  @UseGuards(UserGuard)
  async updateOffer(
    @Param('storeId') storeId: string,
    @Param('offerId') offerId: string,
    @Body() body: any,
    @CurrentUser() user: SessionUser,
  ) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    return this.storesService.updateOffer(store.id, offerId, body ?? {});
  }

  // ==========================================
  // CUPONES DE DESCUENTO DE LA TIENDA
  // ==========================================
  @Get(':storeId/coupons')
  @UseGuards(UserGuard)
  async getCoupons(@Param('storeId') storeId: string, @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    return this.storesService.getCoupons(store.id);
  }

  @Post(':storeId/coupons')
  @UseGuards(UserGuard)
  async createCoupon(@Param('storeId') storeId: string, @Body() body: any, @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    return this.storesService.createCoupon(store.id, body ?? {});
  }

  @Delete(':storeId/coupons/:couponId')
  @UseGuards(UserGuard)
  async deleteCoupon(@Param('storeId') storeId: string, @Param('couponId') couponId: string, @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    return this.storesService.deleteCoupon(store.id, couponId);
  }
}
