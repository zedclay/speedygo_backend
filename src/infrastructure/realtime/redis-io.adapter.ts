import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server, ServerOptions } from 'socket.io';

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
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  async close(): Promise<void> {
    const clients = [this.pub, this.sub];
    this.pub = undefined;
    this.sub = undefined;
    await Promise.all(
      clients.map(async (client) => {
        if (!client) {
          return;
        }
        try {
          if (client.status !== 'end') {
            await client.quit();
          }
        } catch {
          client.disconnect();
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
