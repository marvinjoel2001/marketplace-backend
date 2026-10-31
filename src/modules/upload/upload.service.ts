import { Injectable, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface UploadImageDto {
  base64Data?: string; // Data URI: data:image/png;base64,... or raw base64
  fileName?: string;
  mimeType?: string;
  folder?: 'products' | 'stores' | 'banners' | 'general';
}

/** Where uploaded images live. Set UPLOAD_DIR to a persistent volume in production (e.g. /data/uploads). */
export function uploadRoot(): string {
  return path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'public', 'uploads'));
}

/** The image type a file really is, from its first bytes. */
function sniffImage(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  return null;
}

@Injectable()
export class UploadService {
  private readonly allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  private readonly maxSizeBytes = 5 * 1024 * 1024; // 5 MB
  private readonly uploadDir = uploadRoot();

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

    return this.saveImage(Buffer.from(base64Clean, 'base64'), detectedMime, folder, fileName);
  }

  /**
   * Stores an image sent as raw bytes (the seller panel's fast path: no base64, a quarter fewer bytes on mobile data).
   * Same checks as the base64 upload.
   */
  async saveImage(buffer: Buffer, mimeType: string, folder: string = 'products', fileName = 'foto') {
    const detectedMime = String(mimeType || '').split(';')[0].trim().toLowerCase();
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new BadRequestException('No llegó ninguna imagen');
    }
    if (!this.allowedMimeTypes.includes(detectedMime)) {
      throw new BadRequestException(
        `Tipo de archivo no permitido (${detectedMime}). Tipos válidos: ${this.allowedMimeTypes.join(', ')}`,
      );
    }
    // The declared type must match the file's actual bytes, so nothing but a real image is stored and served.
    if (sniffImage(buffer) !== detectedMime) {
      throw new BadRequestException('El archivo no es una imagen válida (JPG, PNG, WebP o GIF)');
    }

    if (buffer.length > this.maxSizeBytes) {
      throw new BadRequestException(
        `El archivo excede el tamaño máximo permitido de 5 MB (Tamaño recibido: ${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`,
      );
    }

    if (!['products', 'stores', 'banners', 'general'].includes(folder)) {
      throw new BadRequestException('Carpeta de destino no válida');
    }
    const targetSubdir = path.join(this.uploadDir, folder);
    await fs.promises.mkdir(targetSubdir, { recursive: true });

    const ext = detectedMime.split('/')[1] || 'jpg';
    const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueFileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}_${sanitizedName.endsWith(`.${ext}`) ? sanitizedName : `${sanitizedName}.${ext}`}`;
    const filePath = path.join(targetSubdir, uniqueFileName);

    await fs.promises.writeFile(filePath, buffer);

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

    if (items.length > 10) throw new BadRequestException('Sube hasta 10 fotos a la vez');

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
