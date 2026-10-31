import { Controller, Post, Get, Body, Param, Query, UseGuards, NotFoundException } from '@nestjs/common';
import {
  CashRegisterService,
  OpenShiftDto,
  AddMovementDto,
  CloseShiftDto,
} from './cash-register.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, SessionUser, UserGuard, ownedStore } from '../auth/user.guard';

/** Point-of-sale shifts. Only the store's owner opens, moves, closes or reads them. */
@Controller('cash-register')
@UseGuards(UserGuard)
export class CashRegisterController {
  constructor(
    private readonly cashRegisterService: CashRegisterService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('shifts/open')
  async openShift(@Body() dto: OpenShiftDto, @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, String(dto?.storeId ?? ''), user.id);
    return this.cashRegisterService.openShift({ ...dto, storeId: store.id });
  }

  @Get('shifts/current/:storeId')
  async getCurrentShift(@Param('storeId') storeId: string, @CurrentUser() user: SessionUser) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    return this.cashRegisterService.getCurrentShift(store.id);
  }

  @Post('shifts/:id/movements')
  async addMovement(@Param('id') shiftId: string, @Body() dto: AddMovementDto, @CurrentUser() user: SessionUser) {
    await this.ownShift(shiftId, user.id);
    return this.cashRegisterService.addMovement(shiftId, dto);
  }

  @Post('shifts/:id/close')
  async closeShift(@Param('id') shiftId: string, @Body() dto: CloseShiftDto, @CurrentUser() user: SessionUser) {
    await this.ownShift(shiftId, user.id);
    return this.cashRegisterService.closeShift(shiftId, dto);
  }

  @Get('shifts/:storeId/history')
  async getShiftHistory(@Param('storeId') storeId: string, @CurrentUser() user: SessionUser, @Query('limit') limit?: string) {
    const store = await ownedStore(this.prisma, storeId, user.id);
    const take = Math.min(Math.max(parseInt(limit ?? '', 10) || 20, 1), 100);
    return this.cashRegisterService.getShiftHistory(store.id, take);
  }

  private async ownShift(shiftId: string, userId: string) {
    const shift = await this.prisma.cashShift.findUnique({ where: { id: shiftId }, select: { storeId: true } });
    if (!shift) throw new NotFoundException('Turno no encontrado');
    await ownedStore(this.prisma, shift.storeId, userId);
  }
}
