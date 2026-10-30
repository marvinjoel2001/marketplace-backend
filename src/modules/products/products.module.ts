import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { PhotoAiService } from './photo-ai.service';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, PhotoAiService],
  exports: [ProductsService, PhotoAiService],
})
export class ProductsModule {}
