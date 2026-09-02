import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { APP_NAME } from './common/constants/api.constants';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { attachRedisIoAdapter } from './infrastructure/realtime/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  attachRedisIoAdapter(app);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');
  const port = config.get<number>('port', 3000);
  await app.listen(port);
  logger.log(`${APP_NAME} listening on port ${port}`);
  logger.log(`OpenAPI UI: http://localhost:${port}/docs`);
}

void bootstrap();
