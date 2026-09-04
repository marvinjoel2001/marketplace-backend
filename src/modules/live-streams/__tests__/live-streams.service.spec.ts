import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LiveStreamsService } from '../live-streams.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('LiveStreamsService', () => {
  let service: LiveStreamsService;
  let prisma: PrismaService;

  const mockPrisma = {
    liveStream: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    store: {
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveStreamsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<LiveStreamsService>(LiveStreamsService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should query live streams with status LIVE', async () => {
      mockPrisma.liveStream.findMany.mockResolvedValue([
        { id: 'ls1', title: 'Live Shopping', status: 'LIVE' },
      ]);

      const result = await service.findAll();
      expect(Array.isArray(result)).toBe(true);
      expect(mockPrisma.liveStream.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'LIVE' },
        })
      );
    });
  });

  describe('create', () => {
    it('should throw BadRequestException if storeId or title are missing', async () => {
      await expect(
        service.create({ storeId: '', title: '' })
      ).rejects.toThrow(BadRequestException);
    });

    it('should mark store as isLiveNow and create live stream', async () => {
      mockPrisma.store.update.mockResolvedValue({ id: 's1', isLiveNow: true });
      mockPrisma.liveStream.create.mockResolvedValue({
        id: 'ls_new',
        storeId: 's1',
        title: 'Venta de Smartphones',
        status: 'LIVE',
      });

      const result = await service.create({
        storeId: 's1',
        title: 'Venta de Smartphones',
      });

      expect(result.id).toBe('ls_new');
      expect(mockPrisma.store.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { isLiveNow: true },
      });
      expect(mockPrisma.liveStream.create).toHaveBeenCalled();
    });
  });
});
