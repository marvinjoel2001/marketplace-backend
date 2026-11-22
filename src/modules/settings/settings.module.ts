import { Global, Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SupportController } from './support.controller';

@Global()
@Module({
  controllers: [SupportController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
