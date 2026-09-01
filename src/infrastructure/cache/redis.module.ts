import { Global, Module } from '@nestjs/common';

/**
 * Redis connection will be registered when cache/session/lock usage is needed.
 * Local Redis is provided by docker-compose (port 6379).
 */
@Global()
@Module({})
export class RedisModule {}
