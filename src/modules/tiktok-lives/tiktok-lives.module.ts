import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EcommerceClassifier } from './ecommerce-classifier.service';
import { TikTokLivesConfig } from './tiktok-lives.config';
import { TikTokDiscoveryService } from './tiktok-discovery.service';
import { TikTokConnectorService } from './tiktok-connector.service';
import { TikTokLiveCache } from './tiktok-live-cache.service';
import { TikTokLivesService } from './tiktok-lives.service';
import { TikTokLivesWorker } from './tiktok-lives.worker';
import { TikTokLivesController } from './tiktok-lives.controller';
import { TikTokSessionController } from './tiktok-session.controller';
import { LiveFeedService } from './live-feed.service';
import { TikTokDiscoveryHealth } from './tiktok-discovery-health';
import { SellerSignalsService } from './seller-signals.service';
import { StoreTikTokAccountsService } from './store-tiktok-accounts.service';
import { StoreTikTokAccountsController } from './store-tiktok-accounts.controller';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [TikTokLivesController, TikTokSessionController, StoreTikTokAccountsController],
  providers: [
    TikTokDiscoveryHealth,
    TikTokLivesConfig,
    EcommerceClassifier,
    TikTokDiscoveryService,
    TikTokConnectorService,
    TikTokLiveCache,
    TikTokLivesService,
    TikTokLivesWorker,
    LiveFeedService,
    SellerSignalsService,
    StoreTikTokAccountsService,
  ],
  exports: [TikTokLivesService, TikTokLivesWorker],
})
export class TikTokLivesModule {}
