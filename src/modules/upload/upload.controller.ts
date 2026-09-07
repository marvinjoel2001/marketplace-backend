import { Controller, Post, Body } from '@nestjs/common';
import { UploadService, UploadImageDto } from './upload.service';

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('image')
  async uploadImage(@Body() dto: UploadImageDto) {
    return this.uploadService.uploadSingle(dto);
  }

  @Post('batch')
  async uploadBatch(@Body('images') items: UploadImageDto[]) {
    return this.uploadService.uploadBatch(items);
  }
}
