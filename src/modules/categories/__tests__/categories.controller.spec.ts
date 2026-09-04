import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesController } from '../categories.controller';
import { CategoriesService } from '../categories.service';

describe('CategoriesController', () => {
  let controller: CategoriesController;
  let service: CategoriesService;

  const mockCategoriesService = {
    findAll: jest.fn().mockResolvedValue([
      { id: 'cat_1', name: 'Celulares y Telefonía', slug: 'celulares-y-telefonia' },
      { id: 'cat_2', name: 'Electrónica y Tecnología', slug: 'electronica-y-tecnologia' },
    ]),
    findBySlug: jest.fn().mockImplementation((slug) =>
      Promise.resolve({ id: 'cat_1', name: 'Celulares', slug })
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoriesController],
      providers: [
        {
          provide: CategoriesService,
          useValue: mockCategoriesService,
        },
      ],
    }).compile();

    controller = module.get<CategoriesController>(CategoriesController);
    service = module.get<CategoriesService>(CategoriesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAll', () => {
    it('should return all categories', async () => {
      const result = await controller.getAll();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(service.findAll).toHaveBeenCalled();
    });
  });

  describe('getBySlug', () => {
    it('should return category by slug', async () => {
      const result = await controller.getBySlug('celulares-y-telefonia');
      expect(result.slug).toBe('celulares-y-telefonia');
      expect(service.findBySlug).toHaveBeenCalledWith('celulares-y-telefonia');
    });
  });
});
