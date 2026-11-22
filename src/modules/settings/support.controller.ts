import { Controller, Get } from '@nestjs/common';
import { SettingsService } from './settings.service';

/** Public: the support line stores see in their help page (a number meant to be shared). */
@Controller('support')
export class SupportController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  async get() {
    const { whatsapp, message, hours } = await this.settings.getSupport();
    return { available: Boolean(whatsapp), whatsapp, message, hours };
  }
}
