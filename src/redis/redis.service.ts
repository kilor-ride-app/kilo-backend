import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { parseRedisUrl } from './parse-redis-url.util';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService) {
    // REDIS_URL (a full connection string) takes priority — this is what
    // managed providers like Railway hand you. HOST/PORT stays as the local
    // dev fallback (see docker-compose.yml).
    const url = config.get<string>('REDIS_URL');
    this.client = new Redis({
      ...(url
        ? parseRedisUrl(url)
        : {
            host: config.get<string>('REDIS_HOST') ?? 'localhost',
            port: Number(config.get<string>('REDIS_PORT') ?? 6379),
          }),
      lazyConnect: true,
    });
  }

  async onModuleInit() {
    await this.client.connect();
  }

  onModuleDestroy() {
    this.client.disconnect();
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }
}
