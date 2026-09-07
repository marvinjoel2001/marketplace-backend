import { Injectable, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface UploadImageDto {
  base64Data?: string; // Data URI: data:image/png;base64,... or raw base64
  fileName?: string;
  mimeType?: string;
  folder?: 'products' | 'stores' | 'banners' | 'general';
}

@Injectable()
export class UploadService {
  private readonly allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  private readonly maxSizeBytes = 5 * 1024 * 1024; // 5 MB
  private readonly uploadDir = path.join(process.cwd(), 'public', 'uploads');

  constructor() {
    // Asegurar que el directorio de subidas exista
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async uploadSingle(dto: UploadImageDto) {
    const { base64Data, fileName = 'image.jpg', mimeType, folder = 'products' } = dto;

    if (!base64Data) {
      throw new BadRequestException('Se requiere la información de la imagen en base64 (base64Data)');
    }

    let detectedMime = mimeType || 'image/jpeg';
    let base64Clean = base64Data;

    // Detectar Data URI scheme (data:image/png;base64,xxxx)
    const matches = base64Data.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
    if (matches) {
      detectedMime = matches[1].toLowerCase();
      base64Clean = matches[2];
    }

    if (!this.allowedMimeTypes.includes(detectedMime)) {
      throw new BadRequestException(
        `Tipo de archivo no permitido (${detectedMime}). Tipos válidos: ${this.allowedMimeTypes.join(', ')}`,
      );
    }

    const buffer = Buffer.from(base64Clean, 'base64');

    if (buffer.length > this.maxSizeBytes) {
      throw new BadRequestException(
        `El archivo excede el tamaño máximo permitido de 5 MB (Tamaño recibido: ${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`,
      );
    }

    const targetSubdir = path.join(this.uploadDir, folder);
    if (!fs.existsSync(targetSubdir)) {
      fs.mkdirSync(targetSubdir, { recursive: true });
    }

    const ext = detectedMime.split('/')[1] || 'jpg';
    const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueFileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}_${sanitizedName.endsWith(`.${ext}`) ? sanitizedName : `${sanitizedName}.${ext}`}`;
    const filePath = path.join(targetSubdir, uniqueFileName);

    fs.writeFileSync(filePath, buffer);

    const publicUrl = `/uploads/${folder}/${uniqueFileName}`;

    return {
      success: true,
      url: publicUrl,
      fileName: uniqueFileName,
      mimeType: detectedMime,
      sizeBytes: buffer.length,
      uploadedAt: new Date().toISOString(),
    };
  }

  async uploadBatch(items: UploadImageDto[]) {
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('Se requiere un array de imágenes');
    }

    const results = [];
    for (const item of items) {
      results.push(await this.uploadSingle(item));
    }

    return {
      total: results.length,
      images: results,
    };
  }
}
