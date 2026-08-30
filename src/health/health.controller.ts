import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// Excluded from the /api/v1 prefix in main.ts — a bare, unauthenticated
// GET /health is what Railway (and most platforms) expect to poll.
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check() {
    try {
      await Promise.all([this.prisma.$queryRaw`SELECT 1`, this.redis.client.ping()]);
      return { status: 'ok' };
    } catch (err) {
      throw new ServiceUnavailableException(
        `Dependency check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
