import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';

import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { parseRedisUrl } from './redis/parse-redis-url.util';
import { HealthModule } from './health/health.module';

import { AccountsModule } from './accounts/accounts.module';
import { KycModule } from './kyc/kyc.module';
import { ServiceAreasModule } from './service-areas/service-areas.module';
import { WalletModule } from './wallet/wallet.module';
import { PricingModule } from './pricing/pricing.module';
import { RidesModule } from './rides/rides.module';
import { LogisticsModule } from './logistics/logistics.module';
import { KilowattModule } from './kilowatt/kilowatt.module';
import { BusinessModule } from './business/business.module';
import { PromoModule } from './promo/promo.module';
import { PartnershipsModule } from './partnerships/partnerships.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SupportModule } from './support/support.module';
import { AdminOpsModule } from './admin-ops/admin-ops.module';
import { ReportsModule } from './reports/reports.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    // Must be the first import so its exception filter runs before Nest's
    // own — SentryModule.forRoot()'s only job is registering that ordering.
    SentryModule.forRoot(),

    ConfigModule.forRoot({ isGlobal: true }),

    // Redis-backed, shared limits across every app instance (plan.md Section 7)
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100, // default tier — tighter limits applied per-endpoint on OTP/login/payment
      },
    ]),

    // BullMQ default connection — individual queues registered inside
    // the modules that own them (notifications, reports, wallet settlement).
    // REDIS_URL (a full connection string, e.g. Railway's Redis)
    // takes priority; HOST/PORT stays as the local dev fallback.
    BullModule.forRoot({
      connection: process.env.REDIS_URL
        ? parseRedisUrl(process.env.REDIS_URL)
        : {
            host: process.env.REDIS_HOST ?? 'localhost',
            port: Number(process.env.REDIS_PORT ?? 6379),
          },
    }),

    PrismaModule,
    RedisModule,
    HealthModule,

    // Domain modules — see kilo-backend-plan.md Section 1 for ownership
    AccountsModule,
    KycModule,
    ServiceAreasModule,
    WalletModule,
    PricingModule,
    RidesModule,
    LogisticsModule,
    KilowattModule,
    BusinessModule,
    PromoModule,
    PartnershipsModule,
    NotificationsModule,
    SupportModule,
    AdminOpsModule,
    ReportsModule,
    AuditModule,
  ],
  providers: [
    // Applies the ThrottlerModule config above to every route by default
    // (plan.md Section 7: "global rate limiting ... per-user and per-IP
    // tiers"). Individual routes tighten this further via @Throttle().
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Reports every unhandled exception to Sentry, then re-throws so Nest's
    // own default handler still produces the normal HTTP error response —
    // a no-op if SENTRY_DSN isn't set (instrument.ts skips Sentry.init()).
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
  ],
})
export class AppModule {}
