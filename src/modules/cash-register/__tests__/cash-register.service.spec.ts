import { Test, TestingModule } from '@nestjs/testing';
import { CashRegisterService } from '../cash-register.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

describe('CashRegisterService', () => {
  let service: CashRegisterService;
  let prisma: any;

  const mockPrisma = {
    cashShift: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    cashMovement: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashRegisterService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<CashRegisterService>(CashRegisterService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('TC-CAJA-000: Servicio debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('openShift (TC-CAJA-001)', () => {
    it('debería abrir turno de caja exitosamente', async () => {
      mockPrisma.cashShift.findFirst.mockResolvedValue(null);
      mockPrisma.cashShift.create.mockResolvedValue({
        id: 'shift-1',
        storeId: 'store-1',
        cashierName: 'María López',
        initialCash: 200,
        expectedCash: 200,
        status: 'OPEN',
      });

      const result = await service.openShift({
        storeId: 'store-1',
        cashierName: 'María López',
        initialCash: 200,
      });

      expect(result.id).toBe('shift-1');
      expect(result.status).toBe('OPEN');
      expect(result.initialCash).toBe(200);
    });

    it('debería rechazar si ya existe un turno abierto', async () => {
      mockPrisma.cashShift.findFirst.mockResolvedValue({ id: 'active-shift' });

      await expect(
        service.openShift({
          storeId: 'store-1',
          cashierName: 'Carlos',
          initialCash: 100,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('debería rechazar monto inicial negativo', async () => {
      await expect(
        service.openShift({
          storeId: 'store-1',
          cashierName: 'Carlos',
          initialCash: -50,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('addMovement (TC-CAJA-002 & TC-CAJA-003)', () => {
    it('debería registrar venta en efectivo y actualizar saldo esperado', async () => {
      mockPrisma.cashShift.findUnique.mockResolvedValue({
        id: 'shift-1',
        initialCash: 200,
        totalSalesCash: 0,
        totalSalesQr: 0,
        totalSalesCard: 0,
        totalExpenses: 0,
        status: 'OPEN',
      });

      mockPrisma.$transaction.mockResolvedValue([
        { id: 'mov-1', type: 'SALE_CASH', amount: 150 },
        { id: 'shift-1', totalSalesCash: 150, expectedCash: 350 },
      ]);

      const result = await service.addMovement('shift-1', {
        type: 'SALE_CASH',
        amount: 150,
        description: 'Venta mostrador #101',
      });

      expect(result.movement.type).toBe('SALE_CASH');
      expect(result.shift.expectedCash).toBe(350);
    });

    it('debería registrar gasto de caja menor', async () => {
      mockPrisma.cashShift.findUnique.mockResolvedValue({
        id: 'shift-1',
        initialCash: 200,
        totalSalesCash: 150,
        totalSalesQr: 0,
        totalSalesCard: 0,
        totalExpenses: 0,
        status: 'OPEN',
      });

      mockPrisma.$transaction.mockResolvedValue([
        { id: 'mov-2', type: 'EXPENSE', amount: 30 },
        { id: 'shift-1', totalExpenses: 30, expectedCash: 320 },
      ]);

      const result = await service.addMovement('shift-1', {
        type: 'EXPENSE',
        amount: 30,
        description: 'Compra de cinta de embalar',
      });

      expect(result.movement.type).toBe('EXPENSE');
    });

    it('debería rechazar movimientos en turnos cerrados', async () => {
      mockPrisma.cashShift.findUnique.mockResolvedValue({
        id: 'shift-1',
        status: 'CLOSED',
      });

      await expect(
        service.addMovement('shift-1', {
          type: 'SALE_CASH',
          amount: 50,
          description: 'Intento inválido',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('closeShift (TC-CAJA-004 & TC-CAJA-005)', () => {
    it('debería cerrar turno con arqueo exacto (BALANCED)', async () => {
      mockPrisma.cashShift.findUnique.mockResolvedValue({
        id: 'shift-1',
        initialCash: 200,
        totalSalesCash: 100,
        totalSalesQr: 80,
        totalSalesCard: 50,
        totalExpenses: 20,
        status: 'OPEN',
      });

      // Esperado = 200 + 100 - 20 = 280
      mockPrisma.cashShift.update.mockResolvedValue({
        id: 'shift-1',
        initialCash: 200,
        totalSalesCash: 100,
        totalSalesQr: 80,
        totalSalesCard: 50,
        totalExpenses: 20,
        actualCash: 280,
        expectedCash: 280,
        difference: 0,
        status: 'CLOSED',
      });

      const result = await service.closeShift('shift-1', {
        actualCash: 280,
        notes: 'Arqueo perfecto',
      });

      expect(result.status).toBe('CLOSED');
      expect(result.isBalanced).toBe(true);
      expect(result.auditStatus).toBe('BALANCED');
      expect(result.reportSummary.diferencia).toBe(0);
    });

    it('debería detectar faltante de dinero en arqueo (DEFICIT)', async () => {
      mockPrisma.cashShift.findUnique.mockResolvedValue({
        id: 'shift-1',
        initialCash: 200,
        totalSalesCash: 100,
        totalSalesQr: 0,
        totalSalesCard: 0,
        totalExpenses: 0,
        status: 'OPEN',
      });

      // Esperado = 300, pero contado = 280 (Faltan Bs. 20)
      mockPrisma.cashShift.update.mockResolvedValue({
        id: 'shift-1',
        initialCash: 200,
        totalSalesCash: 100,
        totalSalesQr: 0,
        totalSalesCard: 0,
        totalExpenses: 0,
        actualCash: 280,
        expectedCash: 300,
        difference: -20,
        status: 'CLOSED',
      });

      const result = await service.closeShift('shift-1', {
        actualCash: 280,
      });

      expect(result.isBalanced).toBe(false);
      expect(result.auditStatus).toBe('DEFICIT');
      expect(result.difference).toBe(-20);
    });
  });
});
