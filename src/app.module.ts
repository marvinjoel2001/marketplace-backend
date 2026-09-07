import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './modules/products/products.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { StoresModule } from './modules/stores/stores.module';
import { LiveStreamsModule } from './modules/live-streams/live-streams.module';
import { OrdersModule } from './modules/orders/orders.module';
import { DspModule } from './modules/dsp/dsp.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { CashRegisterModule } from './modules/cash-register/cash-register.module';
import { UploadModule } from './modules/upload/upload.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    ProductsModule,
    CategoriesModule,
    StoresModule,
    LiveStreamsModule,
    OrdersModule,
    DspModule,
    AdminModule,
    AuthModule,
    CashRegisterModule,
    UploadModule,
  ],
})
export class AppModule {}
