import { Module } from '@nestjs/common';
import { LiveStreamsController } from './live-streams.controller';
import { LiveStreamsService } from './live-streams.service';
import { TikTokLivesModule } from '../tiktok-lives/tiktok-lives.module';

@Module({
  imports: [TikTokLivesModule],
  controllers: [LiveStreamsController],
  providers: [LiveStreamsService],
  exports: [LiveStreamsService],
})
export class LiveStreamsModule {}
