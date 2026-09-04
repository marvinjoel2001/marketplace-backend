import { Test, TestingModule } from '@nestjs/testing';
import { ProductsController } from '../products.controller';
import { ProductsService } from '../products.service';

describe('ProductsController', () => {
  let controller: ProductsController;
  let service: ProductsService;

  const mockProductsService = {
    findAll: jest.fn().mockImplementation((params) =>
      Promise.resolve([
        {
          id: 'prod_1',
          title: 'Roco Wireless Headphones',
          slug: 'roco-wireless-headphones',
          basePrice: 89,
          offers: [],
        },
      ])
    ),
    findBySlugOrId: jest.fn().mockImplementation((idOrSlug) =>
      Promise.resolve({
        id: 'prod_1',
        title: 'Roco Wireless Headphones',
        slug: idOrSlug,
        basePrice: 89,
        offers: [],
      })
    ),
    create: jest.fn().mockImplementation((body) =>
      Promise.resolve({
        id: 'prod_new',
        ...body,
      })
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        {
          provide: ProductsService,
          useValue: mockProductsService,
        },
      ],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
    service = module.get<ProductsService>(ProductsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAll', () => {
    it('should return an array of products', async () => {
      const result = await controller.getAll('electronica-y-tecnologia', 'true', 'auriculares');
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].title).toBe('Roco Wireless Headphones');
      expect(service.findAll).toHaveBeenCalledWith({
        category: 'electronica-y-tecnologia',
        flashSale: true,
        q: 'auriculares',
        slug: undefined,
      });
    });
  });

  describe('getOne', () => {
    it('should return a product by slug or id', async () => {
      const result = await controller.getOne('roco-wireless-headphones');
      expect(result.slug).toBe('roco-wireless-headphones');
      expect(service.findBySlugOrId).toHaveBeenCalledWith('roco-wireless-headphones');
    });
  });

  describe('create', () => {
    it('should create and return a product', async () => {
      const body = {
        title: 'Nuevo Smartwatch',
        basePrice: 199,
        categoryId: 'cat_1',
      };
      const result = await controller.create(body);
      expect(result.id).toBe('prod_new');
      expect(result.title).toBe('Nuevo Smartwatch');
      expect(service.create).toHaveBeenCalledWith(body);
    });
  });
});
