import { Test, TestingModule } from '@nestjs/testing';
import { UploadService } from '../upload.service';
import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';

jest.mock('fs');

describe('UploadService', () => {
  let service: UploadService;

  beforeEach(async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [UploadService],
    }).compile();

    service = module.get<UploadService>(UploadService);
    jest.clearAllMocks();
  });

  it('TC-IMG-000: Servicio de upload debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('uploadSingle (TC-IMG-001 & TC-IMG-002)', () => {
    it('debería subir imagen válida en base64 exitosamente', async () => {
      // 100 bytes dummy base64
      const sampleBase64 = Buffer.from('fake image content').toString('base64');
      const dataUri = `data:image/jpeg;base64,${sampleBase64}`;

      const result = await service.uploadSingle({
        base64Data: dataUri,
        fileName: 'producto1.jpg',
        folder: 'products',
      });

      expect(result.success).toBe(true);
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.url).toContain('/uploads/products/');
    });

    it('debería rechazar formatos no permitidos (ej. executables o scripts)', async () => {
      const dataUri = `data:application/x-msdownload;base64,VGhpcyBpcyBhIGZha2UgZXhlY3V0YWJsZQ==`;

      await expect(
        service.uploadSingle({
          base64Data: dataUri,
          fileName: 'malware.exe',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('debería rechazar si no se envía base64Data', async () => {
      await expect(
        service.uploadSingle({
          base64Data: '',
          fileName: 'test.png',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('uploadBatch', () => {
    it('debería procesar múltiples imágenes', async () => {
      const sampleBase64 = Buffer.from('img').toString('base64');
      const dataUri = `data:image/png;base64,${sampleBase64}`;

      const result = await service.uploadBatch([
        { base64Data: dataUri, fileName: 'img1.png' },
        { base64Data: dataUri, fileName: 'img2.png' },
      ]);

      expect(result.total).toBe(2);
      expect(result.images.length).toBe(2);
    });

    it('debería fallar si array es vacío', async () => {
      await expect(service.uploadBatch([])).rejects.toThrow(BadRequestException);
    });
  });
});
