import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface OpenShiftDto {
  storeId: string;
  cashierName: string;
  initialCash: number;
  notes?: string;
}

export interface AddMovementDto {
  type: 'SALE_CASH' | 'SALE_QR' | 'SALE_CARD' | 'EXPENSE' | 'WITHDRAWAL';
  amount: number;
  description: string;
  referenceId?: string;
}

export interface CloseShiftDto {
  actualCash: number;
  notes?: string;
}

@Injectable()
export class CashRegisterService {
  constructor(private readonly prisma: PrismaService) {}

  async openShift(dto: OpenShiftDto) {
    const { storeId, cashierName, initialCash, notes } = dto;

    if (!storeId || !cashierName) {
      throw new BadRequestException('storeId y cashierName son requeridos');
    }

    if (initialCash < 0) {
      throw new BadRequestException('El monto inicial no puede ser negativo');
    }

    // Verificar si ya hay un turno abierto para esta tienda
    const activeShift = await this.prisma.cashShift.findFirst({
      where: { storeId, status: 'OPEN' },
    });

    if (activeShift) {
      throw new ConflictException('Ya existe un turno de caja abierto para esta tienda');
    }

    return this.prisma.cashShift.create({
      data: {
        storeId,
        cashierName,
        initialCash: Number(initialCash),
        expectedCash: Number(initialCash),
        status: 'OPEN',
        notes: notes || 'Apertura de turno',
      },
      include: {
        movements: true,
      },
    });
  }

  async getCurrentShift(storeId: string) {
    const activeShift = await this.prisma.cashShift.findFirst({
      where: { storeId, status: 'OPEN' },
      include: {
        movements: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!activeShift) {
      throw new NotFoundException('No hay ningún turno de caja activo para esta tienda');
    }

    return activeShift;
  }

  async addMovement(shiftId: string, dto: AddMovementDto) {
    const shift = await this.prisma.cashShift.findUnique({
      where: { id: shiftId },
    });

    if (!shift) {
      throw new NotFoundException('Turno de caja no encontrado');
    }

    if (shift.status !== 'OPEN') {
      throw new BadRequestException('No se pueden registrar movimientos en un turno de caja cerrado');
    }

    const amount = Number(dto.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new BadRequestException('El monto debe ser un número positivo mayor a 0');
    }

    // Calcular actualización de totales acumulados
    let totalSalesCash = shift.totalSalesCash;
    let totalSalesQr = shift.totalSalesQr;
    let totalSalesCard = shift.totalSalesCard;
    let totalExpenses = shift.totalExpenses;

    switch (dto.type) {
      case 'SALE_CASH':
        totalSalesCash += amount;
        break;
      case 'SALE_QR':
        totalSalesQr += amount;
        break;
      case 'SALE_CARD':
        totalSalesCard += amount;
        break;
      case 'EXPENSE':
      case 'WITHDRAWAL':
        totalExpenses += amount;
        break;
      default:
        throw new BadRequestException(`Tipo de movimiento inválido: ${dto.type}`);
    }

    // El efectivo esperado en caja es: Inicial + Ventas Efectivo - Egresos
    const expectedCash = shift.initialCash + totalSalesCash - totalExpenses;

    const [movement, updatedShift] = await this.prisma.$transaction([
      this.prisma.cashMovement.create({
        data: {
          shiftId,
          type: dto.type,
          amount,
          description: dto.description || 'Movimiento de caja',
          referenceId: dto.referenceId,
        },
      }),
      this.prisma.cashShift.update({
        where: { id: shiftId },
        data: {
          totalSalesCash,
          totalSalesQr,
          totalSalesCard,
          totalExpenses,
          expectedCash,
        },
      }),
    ]);

    return {
      movement,
      shift: updatedShift,
    };
  }

  async closeShift(shiftId: string, dto: CloseShiftDto) {
    const shift = await this.prisma.cashShift.findUnique({
      where: { id: shiftId },
      include: { movements: true },
    });

    if (!shift) {
      throw new NotFoundException('Turno de caja no encontrado');
    }

    if (shift.status === 'CLOSED') {
      throw new BadRequestException('Este turno de caja ya ha sido cerrado previamente');
    }

    const actualCash = Number(dto.actualCash);
    if (isNaN(actualCash) || actualCash < 0) {
      throw new BadRequestException('El conteo físico de efectivo (actualCash) debe ser un número válido >= 0');
    }

    // Efectivo teórico esperado
    const expectedCash = shift.initialCash + shift.totalSalesCash - shift.totalExpenses;
    const difference = Number((actualCash - expectedCash).toFixed(2));

    const closedShift = await this.prisma.cashShift.update({
      where: { id: shiftId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        actualCash,
        expectedCash,
        difference,
        notes: dto.notes ? `${shift.notes ? shift.notes + ' | ' : ''}${dto.notes}` : shift.notes,
      },
      include: {
        movements: true,
      },
    });

    const isBalanced = Math.abs(difference) < 0.01;
    const auditStatus = isBalanced
      ? 'BALANCED'
      : difference > 0
        ? 'SURPLUS' // Sobrante
        : 'DEFICIT'; // Faltante

    return {
      ...closedShift,
      isBalanced,
      auditStatus,
      totalShiftSales: Number((closedShift.totalSalesCash + closedShift.totalSalesQr + closedShift.totalSalesCard).toFixed(2)),
      reportSummary: {
        fondoInicial: closedShift.initialCash,
        ventasEfectivo: closedShift.totalSalesCash,
        ventasQrSimple: closedShift.totalSalesQr,
        ventasTarjeta: closedShift.totalSalesCard,
        gastosCajaMenor: closedShift.totalExpenses,
        efectivoEsperado: closedShift.expectedCash,
        efectivoContado: closedShift.actualCash,
        diferencia: closedShift.difference,
        estadoCuadre: auditStatus,
      },
    };
  }

  async getShiftHistory(storeId: string, limit: number = 20) {
    return this.prisma.cashShift.findMany({
      where: { storeId },
      include: {
        movements: true,
      },
      orderBy: { openedAt: 'desc' },
      take: limit,
    });
  }
}
