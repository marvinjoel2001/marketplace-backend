import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { UploadService, UploadImageDto } from './upload.service';
import { UserGuard } from '../auth/user.guard';

/** Product, logo and payout-QR photos from signed-in users. */
@Controller('upload')
@UseGuards(UserGuard)
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
