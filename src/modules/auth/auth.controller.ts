import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { AuthService, SocialLoginDto, EnrichProfileDto, SyncInterestsDto } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('social-login')
  async socialLogin(@Body() dto: SocialLoginDto) {
    return this.authService.socialLogin(dto);
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
