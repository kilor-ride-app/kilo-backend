import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const CACHE_TTL_SECONDS = 300;
const CACHE_KEY_PREFIX = 'config:';

// Simple key-value tunables that don't belong to a specific domain module
// (Pricing already owns tariffs/commissions) — cache-aside with explicit
// invalidation on write, same pattern as tariffs/service-areas.
@Injectable()
export class PlatformConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async get<T>(key: string, defaultValue: T): Promise<T> {
    const cached = await this.redis.getJson<{ value: T }>(CACHE_KEY_PREFIX + key);
    if (cached) {
      return cached.value;
    }
    const row = await this.prisma.platformConfig.findUnique({ where: { key } });
    const value = row ? (row.value as T) : defaultValue;
    await this.redis.setJson(CACHE_KEY_PREFIX + key, { value }, CACHE_TTL_SECONDS);
    return value;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.prisma.platformConfig.upsert({
      where: { key },
      update: { value: value as Prisma.InputJsonValue },
      create: { key, value: value as Prisma.InputJsonValue },
    });
    await this.redis.client.del(CACHE_KEY_PREFIX + key);
  }

  async getAll(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.platformConfig.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}
