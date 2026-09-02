import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

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
}
