import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server, ServerOptions } from 'socket.io';
import { createSocketIoServerOptions } from '../../config/cors.policy';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pub?: Redis;
  private sub?: Redis;

  connectToRedis(config: ConfigService): void {
    const url = config.get<string>('redisUrl', 'redis://localhost:6379');
    const key = config.get<string>(
      'tracking.socketAdapterPrefix',
      'socket.io:tracking',
    );
    this.pub = new Redis(url, {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });
    this.sub = this.pub.duplicate();
    this.adapterConstructor = createAdapter(this.pub, this.sub, { key });
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const corsPolicy = createSocketIoServerOptions();
    const server = super.createIOServer(port, {
      ...options,
      cors: corsPolicy.cors,
      allowRequest: corsPolicy.allowRequest,
    }) as Server;
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  async close(): Promise<void> {
    const clients = [this.pub, this.sub];
    this.pub = undefined;
    this.sub = undefined;
    this.adapterConstructor = undefined;
    await Promise.all(
      clients.map(async (client) => {
        if (!client) {
          return;
        }
        try {
          client.removeAllListeners();
          if (client.status !== 'end') {
            await client.quit();
          }
        } catch {
          try {
            client.disconnect();
          } catch {
            // Ignore disconnect errors during shutdown.
          }
        }
      }),
    );
  }
}

export function attachRedisIoAdapter(app: INestApplication): RedisIoAdapter {
  const adapter = new RedisIoAdapter(app);
  adapter.connectToRedis(app.get(ConfigService));
  app.useWebSocketAdapter(adapter);
  return adapter;
}
