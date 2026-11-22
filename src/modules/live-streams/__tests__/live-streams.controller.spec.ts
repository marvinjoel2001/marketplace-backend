import { PrismaService } from '../../../prisma/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import { LiveStreamsController } from '../live-streams.controller';
import { LiveStreamsService } from '../live-streams.service';
import { TikTokLivesService } from '../../tiktok-lives/tiktok-lives.service';
import { TikTokLivesWorker } from '../../tiktok-lives/tiktok-lives.worker';

describe('LiveStreamsController', () => {
  let controller: LiveStreamsController;
  let service: LiveStreamsService;

  const mockLiveStreamsService = {
    findAll: jest.fn().mockImplementation((storeId) =>
      Promise.resolve([
        {
          id: 'live_1',
          title: 'Mega Venta de Smartphones en Vivo',
          status: 'LIVE',
          viewerCount: 1420,
          storeId: storeId || 'store_1',
        },
      ])
    ),
    create: jest.fn().mockImplementation((body) =>
      Promise.resolve({
        id: 'live_new',
        ...body,
        status: 'LIVE',
      })
    ),
  };

  const tiktokLives = { linkStoreAccount: jest.fn().mockResolvedValue('techplus_bo') };
  const tiktokWorker = { checkStore: jest.fn() };

  const owner = { id: 'owner_1', role: 'VENDOR' };
  const mockPrisma = { store: { findFirst: jest.fn().mockResolvedValue({ id: 'store_1', slug: 'store_1', ownerId: 'owner_1' }) } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LiveStreamsController],
      providers: [
        {
          provide: LiveStreamsService,
          useValue: mockLiveStreamsService,
        },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TikTokLivesService, useValue: tiktokLives },
        { provide: TikTokLivesWorker, useValue: tiktokWorker },
      ],
    }).compile();

    controller = module.get<LiveStreamsController>(LiveStreamsController);
    service = module.get<LiveStreamsService>(LiveStreamsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAll', () => {
    it('should return active live streams', async () => {
      const result = await controller.getAll('store_1');
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].status).toBe('LIVE');
      expect(service.findAll).toHaveBeenCalledWith('store_1');
    });
  });

  describe('create', () => {
    it('should create a new live stream and set store to live', async () => {
      const dto = {
        storeId: 'store_1',
        title: 'Liquidación de Audífonos',
        tiktokUrl: 'https://www.tiktok.com/@techplus_bo/live',
      };
      const result = await controller.create(dto, owner);
      expect(result.id).toBe('live_new');
      expect(service.create).toHaveBeenCalledWith(dto);
      // The typed TikTok username is linked before the sale opens, then looked for right away.
      expect(tiktokLives.linkStoreAccount).toHaveBeenCalledWith('store_1');
      expect(tiktokWorker.checkStore).toHaveBeenCalledWith('store_1');
    });
  });

  it('no deja transmitir en nombre de una tienda ajena', async () => {
    await expect(controller.create({ storeId: 'store_1', title: 'x' }, { id: 'intruso', role: 'CUSTOMER' })).rejects.toThrow('no es tuya');
  });
});
