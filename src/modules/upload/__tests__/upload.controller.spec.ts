import { Test, TestingModule } from '@nestjs/testing';
import { UploadController } from '../upload.controller';
import { UploadService } from '../upload.service';

describe('UploadController', () => {
  let controller: UploadController;
  let service: UploadService;

  const mockService = {
    uploadSingle: jest.fn(),
    uploadBatch: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UploadController],
      providers: [
        {
          provide: UploadService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<UploadController>(UploadController);
    service = module.get<UploadService>(UploadService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate uploadImage', async () => {
    mockService.uploadSingle.mockResolvedValue({ success: true, url: '/uploads/p1.jpg' });
    const res = await controller.uploadImage({ base64Data: 'data' });
    expect(res.url).toBe('/uploads/p1.jpg');
  });

  it('should delegate uploadBatch', async () => {
    mockService.uploadBatch.mockResolvedValue({ total: 1, images: [] });
    const res = await controller.uploadBatch([{ base64Data: 'data' }]);
    expect(res.total).toBe(1);
  });
});
