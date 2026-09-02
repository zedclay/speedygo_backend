import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

function redisConnection(url: string): {
  host: string;
  port: number;
  db: number;
  maxRetriesPerRequest: null;
} {
  const parsed = new URL(url);
  const db = Number.parseInt(parsed.pathname.replace(/^\//, '') || '0', 10);
  return {
    host: parsed.hostname,
    port: Number.parseInt(parsed.port || '6379', 10),
    db: Number.isFinite(db) ? db : 0,
    maxRetriesPerRequest: null,
  };
}

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        prefix: config.get<string>('matching.bullPrefix', 'bull:matching'),
        connection: redisConnection(
          config.get<string>('redisUrl', 'redis://localhost:6379'),
        ),
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
