import { Test, TestingModule } from '@nestjs/testing';
import { OrdersController } from '../orders.controller';
import { OrdersService } from '../orders.service';

describe('OrdersController', () => {
  let controller: OrdersController;
  let service: OrdersService;

  const mockOrdersService = {
    findAll: jest.fn().mockImplementation((limit) =>
      Promise.resolve([
        {
          id: 'ord_1',
          orderNumber: 'CY-894120-412',
          totalAmount: 189,
          items: [],
        },
      ])
    ),
    findByIdOrNumber: jest.fn().mockImplementation((idOrNumber) =>
      Promise.resolve({
        id: 'ord_1',
        orderNumber: idOrNumber,
        customerName: 'Juan Pérez',
        dspDriverName: 'Carlos Mendoza',
      })
    ),
    create: jest.fn().mockImplementation((body) =>
      Promise.resolve({
        id: 'ord_new',
        orderNumber: 'CY-999999-123',
        ...body,
      })
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        {
          provide: OrdersService,
          useValue: mockOrdersService,
        },
      ],
    }).compile();

    controller = module.get<OrdersController>(OrdersController);
    service = module.get<OrdersService>(OrdersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAll', () => {
    it('should return list of orders', async () => {
      const result = await controller.getAll('10');
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].orderNumber).toBe('CY-894120-412');
      expect(service.findAll).toHaveBeenCalledWith(10);
    });
  });

  describe('getOne', () => {
    it('should return order tracking details by orderNumber', async () => {
      const result = await controller.getOne('CY-894120-412');
      expect(result.orderNumber).toBe('CY-894120-412');
      expect(result.dspDriverName).toBe('Carlos Mendoza');
      expect(service.findByIdOrNumber).toHaveBeenCalledWith('CY-894120-412');
    });
  });

  describe('create', () => {
    it('should create an order with items and dsp dispatch', async () => {
      const dto = {
        customerName: 'Juan Pérez',
        customerPhone: '+591 77098765',
        customerAddress: 'Equipetrol',
        totalAmount: 189,
        paymentMethod: 'QR_SIMPLE',
        items: [],
      };
      const result = await controller.create(dto);
      expect(result.orderNumber).toBeDefined();
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });
});
