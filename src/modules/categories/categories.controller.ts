import { Controller, Get, Param } from '@nestjs/common';
import { CategoriesService } from './categories.service';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  async getAll() {
    return this.categoriesService.findAll();
  }

  @Get(':slug')
  async getBySlug(@Param('slug') slug: string) {
    return this.categoriesService.findBySlug(slug);
  }
}
