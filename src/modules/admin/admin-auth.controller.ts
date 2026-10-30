import { Body, Controller, Get, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard, AdminRequest, AllowWhilePasswordChange } from './admin.guard';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  login(
    @Body() body: { username?: string; password?: string },
    @Headers('x-forwarded-for') forwarded: string | undefined,
    @Req() req: { ip?: string },
  ) {
    return this.auth.login(body?.username ?? '', body?.password ?? '', forwarded?.split(',')[0].trim() || req.ip);
  }

  @Get('me')
  @UseGuards(AdminGuard)
  @AllowWhilePasswordChange()
  me(@Req() req: AdminRequest) {
    return { username: req.admin!.u, mustChangePassword: req.admin!.mcp };
  }

  @Post('change-password')
  @UseGuards(AdminGuard)
  @AllowWhilePasswordChange()
  changePassword(@Req() req: AdminRequest, @Body() body: { currentPassword?: string; newPassword?: string; username?: string }) {
    return this.auth.changePassword(req.admin!.sub, body?.currentPassword ?? '', body?.newPassword ?? '', body?.username);
  }
}
