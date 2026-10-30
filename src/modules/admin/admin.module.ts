import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminAuthController } from './admin-auth.controller';
import { AdminService } from './admin.service';
import { AdminInsightsService } from './admin-insights.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin.guard';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [AuthModule, OrdersModule],
  controllers: [AdminController, AdminAuthController],
  providers: [AdminService, AdminInsightsService, AdminAuthService, AdminGuard],
  exports: [AdminService, AdminAuthService],
})
export class AdminModule {}
