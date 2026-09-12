import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  async getStats() {
    return this.adminService.getStats();
  }

  // ==========================================
  // TIENDAS (STORES) CRUD & SUSPENSIÓN
  // ==========================================
  @Get('stores')
  async getStores() {
    return this.adminService.getStores();
  }

  @Patch('stores/:id/status')
  async updateStoreStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    return this.adminService.updateStoreStatus(id, status);
  }

  @Patch('stores/:id')
  async updateStore(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.adminService.updateStore(id, body);
  }

  @Delete('stores/:id')
  async deleteStore(@Param('id') id: string) {
    return this.adminService.deleteStore(id);
  }

  // ==========================================
  // USUARIOS (USERS) CRUD & ROLES
  // ==========================================
  @Get('users')
  async getUsers() {
    return this.adminService.getUsers();
  }

  @Patch('users/:id/role')
  async updateUserRole(
    @Param('id') id: string,
    @Body('role') role: string,
  ) {
    return this.adminService.updateUserRole(id, role);
  }

  @Patch('users/:id/status')
  async updateUserStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    return this.adminService.updateUserStatus(id, status);
  }

  @Delete('users/:id')
  async deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  // ==========================================
  // PEDIDOS GLOBALES & CANCELACIÓN POR TIENDA
  // ==========================================
  @Get('orders')
  async getOrders(
    @Query('storeId') storeId?: string,
    @Query('status') status?: string,
  ) {
    return this.adminService.getOrders({ storeId, status });
  }

  @Post('orders/:id/cancel')
  async cancelOrder(
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.adminService.cancelOrder(id, reason);
  }

  // ==========================================
  // CATÁLOGO & MODERACIÓN DE PRODUCTOS
  // ==========================================
  @Get('products')
  async getProducts() {
    return this.adminService.getProducts();
  }

  @Patch('products/:id/moderate')
  async moderateProduct(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    return this.adminService.moderateProduct(id, status);
  }

  @Delete('products/:id')
  async deleteProduct(@Param('id') id: string) {
    return this.adminService.deleteProduct(id);
  }

  // ==========================================
  // MÉTODOS DE PAGO Y PASARELAS
  // ==========================================
  @Get('payment-configs')
  async getPaymentConfigs() {
    return this.adminService.getPaymentConfigs();
  }

  @Put('payment-configs/:key')
  async updatePaymentConfig(
    @Param('key') key: string,
    @Body() body: any,
  ) {
    return this.adminService.updatePaymentConfig(key, body);
  }
}
