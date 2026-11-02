import { Controller, Get, Param, Post } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

// Same access model as GET /orders/user/:userId: the web asks with the id of the signed-in customer.
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('user/:userId')
  list(@Param('userId') userId: string) {
    return this.notifications.forUser(userId);
  }

  @Post('user/:userId/read')
  markRead(@Param('userId') userId: string) {
    return this.notifications.markAllRead(userId);
  }
}
