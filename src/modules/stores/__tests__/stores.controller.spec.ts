import { Test, TestingModule } from '@nestjs/testing';
import { StoresController } from '../stores.controller';
import { StoresService } from '../stores.service';

describe('StoresController', () => {
  let controller: StoresController;
  let service: StoresService;

  const mockStoresService = {
    findAll: jest.fn().mockImplementation((params) =>
      Promise.resolve([
        {
          id: 'store_1',
          name: 'TechPlus Bolivia',
          slug: 'techplus-bolivia',
          isLive: params?.isLive ?? false,
          isOfficial: true,
        },
      ])
    ),
    findBySlugOrId: jest.fn().mockImplementation((idOrSlug) =>
      Promise.resolve({
        id: 'store_1',
        name: 'TechPlus Bolivia',
        slug: idOrSlug,
      })
    ),
    create: jest.fn().mockImplementation((body) =>
      Promise.resolve({
        id: 'store_new',
        ...body,
      })
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StoresController],
      providers: [
        {
          provide: StoresService,
          useValue: mockStoresService,
        },
      ],
    }).compile();

    controller = module.get<StoresController>(StoresController);
    service = module.get<StoresService>(StoresService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAll', () => {
    it('should return stores with isLive filter', async () => {
      const result = await controller.getAll('true');
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].name).toBe('TechPlus Bolivia');
      expect(service.findAll).toHaveBeenCalledWith({ isLive: true });
    });
  });

  describe('getOne', () => {
    it('should return single store by slug', async () => {
      const result = await controller.getOne('techplus-bolivia');
      expect(result.slug).toBe('techplus-bolivia');
      expect(service.findBySlugOrId).toHaveBeenCalledWith('techplus-bolivia');
    });
  });

  describe('create', () => {
    it('should create a store', async () => {
      const dto = {
        name: 'NovaStore Bolivia',
        category: 'Moda y Accesorios',
        phone: '+591 77012345',
        address: 'Equipetrol',
      };
      const result = await controller.create(dto);
      expect(result.id).toBe('store_new');
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });
});
