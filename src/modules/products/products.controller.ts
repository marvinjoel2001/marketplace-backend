import { Controller, Get, Post, Put, Patch, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { PhotoAiService } from './photo-ai.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, SessionUser, UserGuard, assertProductOwner, ownedStore } from '../auth/user.guard';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly photoAi: PhotoAiService,
    private readonly prisma: PrismaService,
  ) {}

  /** Whether sellers get their product form filled from the photo. */
  @Get('photo-ai/status')
  async photoAiStatus() {
    return this.photoAi.status();
  }

  @Post('photo-ai/analyze')
  @UseGuards(UserGuard)
  async analyzePhoto(@Body() body: { storeId?: string; image?: string }, @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, String(body?.storeId ?? ''), user.id);
    return this.photoAi.analyze({ ...body, storeId: store.id });
  }

  @Get()
  async getAll(
    @Query('category') category?: string,
    @Query('flashSale') flashSale?: string,
    @Query('q') q?: string,
    @Query('slug') slug?: string,
  ) {
    return this.productsService.findAll({
      category,
      flashSale: flashSale === 'true',
      q,
      slug,
    });
  }

  @Get(':idOrSlug')
  async getOne(@Param('idOrSlug') idOrSlug: string) {
    return this.productsService.findBySlugOrId(idOrSlug);
  }

  @Post()
  @UseGuards(UserGuard)
  async create(@Body() body: any, @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, String(body?.storeId ?? ''), user.id);
    return this.productsService.create({ ...body, storeId: store.id });
  }

  @Put(':id')
  @UseGuards(UserGuard)
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: SessionUser) {
    await assertProductOwner(this.prisma, id, user.id);
    return this.productsService.update(id, body ?? {});
  }

  @Patch(':id/stock')
  @UseGuards(UserGuard)
  async updateStock(
    @Param('id') id: string,
    @Body() body: { storeId: string; stock: number; price?: number },
    @CurrentUser() user: SessionUser,
  ) {
    const store = await ownedStore(this.prisma, String(body?.storeId ?? ''), user.id);
    return this.productsService.updateStock(id, store.id, Number(body.stock), body.price === undefined ? undefined : Number(body.price));
  }

  @Delete(':id')
  @UseGuards(UserGuard)
  async delete(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    await assertProductOwner(this.prisma, id, user.id);
    return this.productsService.delete(id);
  }
}
