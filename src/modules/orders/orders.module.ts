import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { DspModule } from '../dsp/dsp.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [DspModule, NotificationsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
