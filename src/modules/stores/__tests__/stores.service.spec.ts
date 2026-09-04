import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { StoresService } from '../stores.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('StoresService', () => {
  let service: StoresService;
  let prisma: PrismaService;

  const mockPrisma = {
    store: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoresService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<StoresService>(StoresService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should find stores with isLive condition', async () => {
      mockPrisma.store.findMany.mockResolvedValue([
        { id: 's1', name: 'TechPlus', isLive: true },
      ]);

      const result = await service.findAll({ isLive: true });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(mockPrisma.store.findMany).toHaveBeenCalled();
    });
  });

  describe('findBySlugOrId', () => {
    it('should find store by slug', async () => {
      mockPrisma.store.findFirst.mockResolvedValue({
        id: 's1',
        name: 'TechPlus',
        slug: 'techplus',
      });

      const result = await service.findBySlugOrId('techplus');
      expect(result.slug).toBe('techplus');
    });

    it('should throw NotFoundException if store does not exist', async () => {
      mockPrisma.store.findFirst.mockResolvedValue(null);
      await expect(service.findBySlugOrId('inexistente')).rejects.toThrow(
        NotFoundException
      );
    });
  });
});
