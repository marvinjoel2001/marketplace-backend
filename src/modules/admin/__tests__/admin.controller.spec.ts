import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from '../admin.controller';
import { AdminService } from '../admin.service';

describe('AdminController', () => {
  let controller: AdminController;
  let service: AdminService;

  const mockAdminService = {
    getStats: jest.fn().mockResolvedValue({
      totalStores: 42,
      totalOrders: 1284,
      totalVolume: 452900,
      totalCommission: 22645,
      dspConnected: true,
      stores: [],
      recentOrders: [],
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        {
          provide: AdminService,
          useValue: mockAdminService,
        },
      ],
    }).compile();

    controller = module.get<AdminController>(AdminController);
    service = module.get<AdminService>(AdminService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getStats', () => {
    it('should return marketplace dashboard statistics', async () => {
      const result = await controller.getStats();
      expect(result.totalOrders).toBe(1284);
      expect(result.totalStores).toBe(42);
      expect(result.dspConnected).toBe(true);
      expect(service.getStats).toHaveBeenCalled();
    });
  });
});
