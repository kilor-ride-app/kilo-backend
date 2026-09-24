import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DriversModule } from '../drivers/drivers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GoogleMapsModule } from '../integrations/google-maps/google-maps.module';
import { R2Module } from '../integrations/r2/r2.module';
import { SmsModule } from '../integrations/sms/sms.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { PricingModule } from '../pricing/pricing.module';
import { PromoModule } from '../promo/promo.module';
import { RidesModule } from '../rides/rides.module';
import { ServiceAreasModule } from '../service-areas/service-areas.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminLogisticsController } from './admin-logistics.controller';
import { AdminLogisticsService } from './admin-logistics.service';
import { LogisticsDispatchService } from './logistics-dispatch.service';
import { LogisticsTripService } from './logistics-trip.service';
import { LogisticsController } from './logistics.controller';
import { DELIVERY_SCHEDULE_QUEUE, LogisticsService } from './logistics.service';
import { DeliveryScheduleProcessor } from './delivery-schedule.processor';
import { PublicTrackingController } from './public-tracking.controller';

@Module({
  imports: [
    GoogleMapsModule,
    PricingModule,
    PromoModule,
    ServiceAreasModule,
    WalletModule,
    SmsModule,
    R2Module,
    AuditModule,
    PlatformConfigModule,
    DriversModule,
    NotificationsModule,
    BullModule.registerQueue({ name: DELIVERY_SCHEDULE_QUEUE }),
    // For DriverOffersGateway (delivery-offer push) and nothing else — see
    // plan.md Section 6: "Logistics reuses dispatch/trip/wallet infra from
    // rides." RidesModule never imports LogisticsModule back.
    RidesModule,
  ],
  controllers: [LogisticsController, AdminLogisticsController, PublicTrackingController],
  providers: [
    LogisticsService,
    LogisticsDispatchService,
    LogisticsTripService,
    AdminLogisticsService,
    DeliveryScheduleProcessor,
  ],
  // LogisticsService exported specifically so BusinessModule can book
  // business-billed deliveries through the same booking/dispatch path
  // individual senders use — see plan.md Section 6.
  exports: [LogisticsService],
})
export class LogisticsModule {}
