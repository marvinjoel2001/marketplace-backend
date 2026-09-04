import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProductsService } from '../products.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: PrismaService;

  const mockPrisma = {
    product: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should find all products with filters', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 'p1', title: 'iPhone 15 Pro', isFlashSale: true },
      ]);

      const result = await service.findAll({ flashSale: true, q: 'iphone' });
      expect(Array.isArray(result)).toBe(true);
      expect((result as any).length).toBe(1);
      expect(mockPrisma.product.findMany).toHaveBeenCalled();
    });

    it('should find a single product if slug is specified in params', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        title: 'iPhone 15 Pro',
        slug: 'iphone-15-pro',
      });

      const result = await service.findAll({ slug: 'iphone-15-pro' });
      expect(result).toBeDefined();
      expect((result as any).slug).toBe('iphone-15-pro');
    });

    it('should throw NotFoundException if slug is not found in findAll', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(service.findAll({ slug: 'non-existing' })).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('findBySlugOrId', () => {
    it('should find product by id or slug', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        id: 'p1',
        title: 'MacBook Air',
        slug: 'macbook-air',
      });

      const result = await service.findBySlugOrId('macbook-air');
      expect(result.title).toBe('MacBook Air');
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);
      await expect(service.findBySlugOrId('missing')).rejects.toThrow(
        NotFoundException
      );
    });
  });
});
