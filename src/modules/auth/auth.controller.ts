import { Controller, Post, Get, Body, Param, Headers, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { AuthService, SocialLoginDto, EnrichProfileDto, SyncInterestsDto, normalizeBoliviaPhone } from './auth.service';
import { OtpService } from './otp.service';
import { InternalKeyGuard } from './internal-key.guard';

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

  /** Step 2: the code proves the number, and only then is the session user returned. */
  @Post('otp/verify')
  @UseGuards(InternalKeyGuard)
  async verifyOtp(@Body() body: { phone?: string; code?: string; idToken?: string }) {
    if (body?.idToken) {
      const phone = normalizeBoliviaPhone(body?.phone ?? '');
      if (!phone) throw new BadRequestException('Número inválido');
      return this.authService.loginWithVerifiedPhone(phone);
    }
    const phone = await this.otp.verify(body?.phone ?? '', body?.code ?? '');
    return this.authService.loginWithVerifiedPhone(phone);
  }

  @Post('enrich-profile')
  async enrichProfile(@Body() dto: EnrichProfileDto) {
    return this.authService.enrichProfile(dto);
  }

  @Post('sync-interests')
  async syncInterests(@Body() dto: SyncInterestsDto) {
    return this.authService.syncInterests(dto);
  }

  @Get('me/:id')
  async getUser(@Param('id') id: string) {
    return this.authService.getUser(id);
  }
}
