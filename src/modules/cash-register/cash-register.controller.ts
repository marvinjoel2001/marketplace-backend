import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import {
  CashRegisterService,
  OpenShiftDto,
  AddMovementDto,
  CloseShiftDto,
} from './cash-register.service';

@Controller('cash-register')
export class CashRegisterController {
  constructor(private readonly cashRegisterService: CashRegisterService) {}

  @Post('shifts/open')
  async openShift(@Body() dto: OpenShiftDto) {
    return this.cashRegisterService.openShift(dto);
  }

  @Get('shifts/current/:storeId')
  async getCurrentShift(@Param('storeId') storeId: string) {
    return this.cashRegisterService.getCurrentShift(storeId);
  }

  @Post('shifts/:id/movements')
  async addMovement(
    @Param('id') shiftId: string,
    @Body() dto: AddMovementDto,
  ) {
    return this.cashRegisterService.addMovement(shiftId, dto);
  }

  @Post('shifts/:id/close')
  async closeShift(
    @Param('id') shiftId: string,
    @Body() dto: CloseShiftDto,
  ) {
    return this.cashRegisterService.closeShift(shiftId, dto);
  }

  @Get('shifts/:storeId/history')
  async getShiftHistory(
    @Param('storeId') storeId: string,
    @Query('limit') limit?: string,
  ) {
    return this.cashRegisterService.getShiftHistory(
      storeId,
      limit ? parseInt(limit, 10) : 20,
    );
  }
}
