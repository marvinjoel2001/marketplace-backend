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
      update: jest.fn(),
      delete: jest.fn(),
    },
    productOffer: {
      findFirst: jest.fn(),
      update: jest.fn(),
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

  describe('update & updateStock (TC-SYNC-001)', () => {
    it('debería actualizar datos del producto', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        offers: [{ id: 'off-1', storeId: 'store-1' }],
      });
      mockPrisma.product.update.mockResolvedValue({
        id: 'p1',
        title: 'iPhone 15 Pro Max Actualizado',
        basePrice: 8500,
      });

      const res = await service.update('p1', {
        title: 'iPhone 15 Pro Max Actualizado',
        basePrice: 8500,
      });

      expect(res.title).toBe('iPhone 15 Pro Max Actualizado');
      expect(mockPrisma.product.update).toHaveBeenCalled();
    });

    it('debería actualizar stock de producto por tienda', async () => {
      mockPrisma.productOffer.findFirst.mockResolvedValue({
        id: 'off-1',
        productId: 'p1',
        storeId: 'store-1',
        stock: 5,
      });
      mockPrisma.productOffer.update.mockResolvedValue({
        id: 'off-1',
        stock: 12,
        price: 8400,
      });

      const res = await service.updateStock('p1', 'store-1', 12, 8400);
      expect(res.stock).toBe(12);
      expect(mockPrisma.productOffer.update).toHaveBeenCalledWith({
        where: { id: 'off-1' },
        data: { stock: 12, price: 8400 },
        include: { product: true, store: true },
      });
    });
  });

  describe('delete', () => {
    it('debería eliminar producto existente', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'p1' });
      mockPrisma.product.delete.mockResolvedValue({ id: 'p1' });

      const res = await service.delete('p1');
      expect(res.success).toBe(true);
      expect(mockPrisma.product.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    });
  });
});

