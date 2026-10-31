import { Controller, Post, Body, Headers, Query, Req, UseGuards } from '@nestjs/common';
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

  /** The photo as raw bytes (Content-Type image/jpeg, png or webp): what the seller panel uses. */
  @Post('image/raw')
  async uploadRaw(@Req() req: { body: unknown }, @Headers('content-type') contentType: string, @Query('folder') folder?: string) {
    return this.uploadService.saveImage(req.body as Buffer, contentType, folder || 'products');
  }

  @Post('batch')
  async uploadBatch(@Body('images') items: UploadImageDto[]) {
    return this.uploadService.uploadBatch(items);
  }
}
