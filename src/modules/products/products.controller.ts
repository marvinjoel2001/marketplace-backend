import { Controller, Get, Post, Put, Patch, Delete, Param, Query, Body } from '@nestjs/common';
import { ProductsService } from './products.service';
import { PhotoAiService } from './photo-ai.service';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly photoAi: PhotoAiService,
  ) {}

  /** Whether sellers get their product form filled from the photo. */
  @Get('photo-ai/status')
  async photoAiStatus() {
    return this.photoAi.status();
  }

  @Post('photo-ai/analyze')
  async analyzePhoto(@Body() body: { storeId?: string; image?: string }) {
    return this.photoAi.analyze(body ?? {});
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
  async create(@Body() body: any) {
    return this.productsService.create(body);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.productsService.update(id, body);
  }

  @Patch(':id/stock')
  async updateStock(
    @Param('id') id: string,
    @Body() body: { storeId: string; stock: number; price?: number },
  ) {
    return this.productsService.updateStock(id, body.storeId, body.stock, body.price);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.productsService.delete(id);
  }
}

