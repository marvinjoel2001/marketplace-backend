import { Module } from '@nestjs/common';
import { LiveStreamsController } from './live-streams.controller';
import { LiveStreamsService } from './live-streams.service';

@Module({
  controllers: [LiveStreamsController],
  providers: [LiveStreamsService],
  exports: [LiveStreamsService],
})
export class LiveStreamsModule {}
