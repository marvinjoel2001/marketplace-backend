import { Controller, Post, Get, Body, Headers, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { AuthService, SocialLoginDto, EnrichProfileDto, SyncInterestsDto, normalizeBoliviaPhone } from './auth.service';
import { OtpService } from './otp.service';
import { InternalKeyGuard } from './internal-key.guard';
import { CurrentUser, SessionUser, UserGuard } from './user.guard';
import { firebaseVerifiedPhone } from './firebase-phone';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly otp: OtpService,
  ) {}

  @Post('social-login')
  @UseGuards(InternalKeyGuard)
  async socialLogin(@Body() dto: SocialLoginDto) {
    return this.authService.socialLogin(dto);
  }

  /** Step 1 of phone sign-in: sends a six-digit code to the number's WhatsApp. */
  @Post('otp/request')
  @UseGuards(InternalKeyGuard)
  async requestOtp(@Body() body: { phone?: string }, @Headers('x-client-ip') clientIp: string | undefined, @Req() req: { ip?: string }) {
    return this.otp.request(body?.phone ?? '', clientIp || req.ip);
  }

  /** Step 2: the code (or a Firebase token for that same number) proves the number, and only then is the user returned. */
  @Post('otp/verify')
  @UseGuards(InternalKeyGuard)
  async verifyOtp(@Body() body: { phone?: string; code?: string; idToken?: string }) {
    if (body?.idToken) {
      const phone = normalizeBoliviaPhone(body.phone ?? '');
      const proven = normalizeBoliviaPhone((await firebaseVerifiedPhone(body.idToken)) ?? '');
      if (!phone || proven !== phone) throw new UnauthorizedException('No pudimos confirmar tu número. Pide otro código.');
      return this.authService.loginWithVerifiedPhone(phone);
    }
    const phone = await this.otp.verify(body?.phone ?? '', body?.code ?? '');
    return this.authService.loginWithVerifiedPhone(phone);
  }

  @Post('enrich-profile')
  @UseGuards(UserGuard)
  async enrichProfile(@Body() dto: EnrichProfileDto, @CurrentUser() user: SessionUser) {
    return this.authService.enrichProfile({ ...dto, userId: user.id });
  }

  @Post('sync-interests')
  @UseGuards(UserGuard)
  async syncInterests(@Body() dto: SyncInterestsDto, @CurrentUser() user: SessionUser) {
    return this.authService.syncInterests({ ...dto, userId: user.id });
  }

  @Get('me')
  @UseGuards(UserGuard)
  async getUser(@CurrentUser() user: SessionUser) {
    return this.authService.getUser(user.id);
  }
}
