import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Enable CORS
  app.enableCors({
    origin: true, // Allow all origins in local dev
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  const port = process.env.PORT || 4000;
  await app.listen(port);

  logger.log(`=======================================================`);
  logger.log(`🚀 CompraYa Marketplace Backend (NestJS) running on:`);
  logger.log(`👉 http://localhost:${port}/api/v1`);
  logger.log(`📦 Health & Endpoints ready:`);
  logger.log(`   - GET  /api/v1/products`);
  logger.log(`   - GET  /api/v1/categories`);
  logger.log(`   - GET  /api/v1/stores`);
  logger.log(`   - GET  /api/v1/live-streams`);
  logger.log(`   - POST /api/v1/orders`);
  logger.log(`   - POST /api/v1/dsp/quote`);
  logger.log(`   - GET  /api/v1/admin/stats`);
  logger.log(`=======================================================`);
}

bootstrap();
