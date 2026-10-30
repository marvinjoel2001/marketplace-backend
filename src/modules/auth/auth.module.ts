import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { OtpService } from './otp.service';
import { WhatsAppService } from './whatsapp.service';
import { InternalKeyGuard } from './internal-key.guard';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, OtpService, WhatsAppService, InternalKeyGuard],
  exports: [AuthService, OtpService, WhatsAppService],
})
export class AuthModule {}
