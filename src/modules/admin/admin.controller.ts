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
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminInsightsService } from './admin-insights.service';
import { AdminGuard } from './admin.guard';
import { SettingsService, ShippingRates, VISION_MODELS, VisionAiSettings, WhatsAppSettings } from '../settings/settings.service';
import { PhotoAiService } from '../products/photo-ai.service';
import { WhatsAppService } from '../auth/whatsapp.service';
import { OrdersService } from '../orders/orders.service';
import { normalizeBoliviaPhone } from '../auth/auth.service';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly insights: AdminInsightsService,
    private readonly settings: SettingsService,
    private readonly whatsapp: WhatsAppService,
    private readonly orders: OrdersService,
    private readonly photoAi: PhotoAiService,
  ) {}

  // ==========================================
  // PANEL: métricas, tiendas, pedidos, envíos, pagos
  // ==========================================
  @Get('overview')
  overview() {
    return this.insights.overview();
  }

  @Get('stores/overview')
  storesOverview() {
    return this.insights.stores();
  }

  @Get('stores/:id/detail')
  storeDetail(@Param('id') id: string) {
    return this.insights.storeDetail(id);
  }

  @Patch('stores/:id/config')
  updateStoreConfig(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.insights.updateStoreConfig(id, body as never);
  }

  @Get('orders/overview')
  ordersOverview(@Query() query: { status?: string; storeId?: string; from?: string; to?: string; q?: string }) {
    return this.insights.orders(query);
  }

  @Patch('orders/:id/status')
  setOrderStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.orders.updateStatus(id, status);
  }

  @Get('shipments')
  shipments(@Query('from') from?: string, @Query('to') to?: string) {
    return this.insights.shipments(from, to);
  }

  @Get('payouts')
  payouts() {
    return this.insights.payouts();
  }

  @Post('payouts')
  createPayout(@Body() body: Record<string, unknown>) {
    return this.insights.createPayout(body as never);
  }

  @Get('notifications')
  notifications() {
    return this.insights.notifications();
  }

  @Post('notifications/seen')
  notificationsSeen() {
    return this.insights.markNotificationsSeen();
  }

  // ==========================================
  // TARIFAS DE ENVÍO (repartidor) y WHATSAPP
  // ==========================================
  @Get('shipping')
  getShipping() {
    return this.settings.getShipping();
  }

  @Put('shipping')
  setShipping(@Body() body: Partial<ShippingRates>) {
    return this.settings.setShipping(body);
  }

  @Post('shipping/preview')
  previewShipping(@Body() body: { storeId?: string; dropoffLat?: number; dropoffLng?: number }) {
    return this.insights.previewShipping(body);
  }

  @Get('whatsapp')
  async getWhatsApp() {
    const cfg = await this.settings.getWhatsApp();
    return { settings: { ...cfg, apiKey: '', hasApiKey: Boolean(cfg.apiKey) }, status: await this.whatsapp.status() };
  }

  @Put('whatsapp')
  async setWhatsApp(@Body() body: Partial<WhatsAppSettings>) {
    const cfg = await this.settings.setWhatsApp(body);
    return { settings: { ...cfg, apiKey: '', hasApiKey: Boolean(cfg.apiKey) }, status: await this.whatsapp.status() };
  }

  @Post('whatsapp/test')
  async testWhatsApp(@Body() body: { phone?: string }) {
    const phone = normalizeBoliviaPhone(String(body?.phone ?? ''));
    if (!phone) throw new BadRequestException('Escribe un celular boliviano de 8 dígitos');
    const sent = await this.whatsapp.send(phone, 'Mensaje de prueba de Vitrina Market: tu WhatsApp quedó conectado.');
    return { sent: sent.delivered, devOnly: Boolean(sent.devOnly) };
  }

  // The key never goes back to the browser: only whether one is saved and its last characters.
  @Get('vision-ai')
  async getVisionAi() {
    return visionView(await this.settings.getVisionAi());
  }

  @Put('vision-ai')
  async setVisionAi(@Body() body: Partial<VisionAiSettings> & { removeKey?: boolean }) {
    return visionView(await this.settings.setVisionAi(body ?? {}));
  }

  @Post('vision-ai/test')
  async testVisionAi(@Body() body: { apiKey?: string; model?: string }) {
    return this.photoAi.testKey(body?.apiKey, body?.model);
  }

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
    // Same path as any status change: stock goes back once, and delivered or cancelled orders can't be cancelled again.
    const order = await this.orders.updateStatus(id, 'CANCELLED');
    return {
      success: true,
      message: `Pedido #${order.orderNumber} cancelado exitosamente por el Administrador.`,
      reason: reason || 'Cancelación administrativa de plataforma',
      order,
    };
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

function visionView(cfg: VisionAiSettings) {
  return {
    enabled: cfg.enabled,
    model: cfg.model,
    models: VISION_MODELS,
    hasApiKey: Boolean(cfg.apiKey),
    keyHint: cfg.apiKey ? `…${cfg.apiKey.slice(-4)}` : '',
    fromEnv: Boolean(process.env.ANTHROPIC_API_KEY) && cfg.apiKey === process.env.ANTHROPIC_API_KEY,
  };
}
