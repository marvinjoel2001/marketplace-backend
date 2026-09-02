import { Module } from '@nestjs/common';
import { DspController } from './dsp.controller';
import { DspService } from './dsp.service';

@Module({
  controllers: [DspController],
  providers: [DspService],
  exports: [DspService],
})
export class DspModule {}
