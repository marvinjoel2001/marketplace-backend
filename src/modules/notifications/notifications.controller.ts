import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CurrentUser, SessionUser, UserGuard } from '../auth/user.guard';

/** Each person reads only their own notifications: the id comes from the session, never from the URL. */
@Controller('notifications')
@UseGuards(UserGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('mine')
  list(@CurrentUser() user: SessionUser) {
    return this.notifications.forUser(user.id);
  }

  @Post('mine/read')
  markRead(@CurrentUser() user: SessionUser) {
    return this.notifications.markAllRead(user.id);
  }
}
