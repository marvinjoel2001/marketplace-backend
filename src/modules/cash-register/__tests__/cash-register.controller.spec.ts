import { Test, TestingModule } from '@nestjs/testing';
import { CashRegisterController } from '../cash-register.controller';
import { CashRegisterService } from '../cash-register.service';

describe('CashRegisterController', () => {
  let controller: CashRegisterController;
  let service: CashRegisterService;

  const mockService = {
    openShift: jest.fn(),
    getCurrentShift: jest.fn(),
    addMovement: jest.fn(),
    closeShift: jest.fn(),
    getShiftHistory: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CashRegisterController],
      providers: [
        {
          provide: CashRegisterService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<CashRegisterController>(CashRegisterController);
    service = module.get<CashRegisterService>(CashRegisterService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate openShift', async () => {
    mockService.openShift.mockResolvedValue({ id: 'shift-1' });
    const result = await controller.openShift({
      storeId: 'store-1',
      cashierName: 'Juan',
      initialCash: 100,
    });
    expect(result.id).toBe('shift-1');
  });

  it('should delegate getCurrentShift', async () => {
    mockService.getCurrentShift.mockResolvedValue({ id: 'shift-1', status: 'OPEN' });
    const result = await controller.getCurrentShift('store-1');
    expect(result.status).toBe('OPEN');
  });

  it('should delegate addMovement', async () => {
    mockService.addMovement.mockResolvedValue({ movement: { id: 'm1' } });
    const result = await controller.addMovement('shift-1', {
      type: 'SALE_CASH',
      amount: 50,
      description: 'Test',
    });
    expect(result.movement.id).toBe('m1');
  });

  it('should delegate closeShift', async () => {
    mockService.closeShift.mockResolvedValue({ status: 'CLOSED', isBalanced: true });
    const result = await controller.closeShift('shift-1', { actualCash: 150 });
    expect(result.status).toBe('CLOSED');
  });
});
