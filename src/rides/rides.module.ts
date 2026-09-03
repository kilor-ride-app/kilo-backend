import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { GoogleMapsModule } from '../integrations/google-maps/google-maps.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { PricingModule } from '../pricing/pricing.module';
import { PromoModule } from '../promo/promo.module';
import { ServiceAreasModule } from '../service-areas/service-areas.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminRidesController } from './admin-rides.controller';
import { AdminRidesService } from './admin-rides.service';
import { CancellationService } from './cancellation.service';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';
import { DriverOffersGateway } from './gateways/driver-offers.gateway';
import { RideTrackingGateway } from './gateways/ride-tracking.gateway';
import { PlacesController } from './places.controller';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';
import { TripService } from './trip.service';

@Module({
  imports: [
    GoogleMapsModule,
    PlatformConfigModule,
    PricingModule,
    PromoModule,
    ServiceAreasModule,
    WalletModule,
    // Gateways verify the same access token as every REST endpoint —
    // registered here too since this module's sockets authenticate
    // independently of the HTTP guard chain.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
      }),
    }),
  ],
  controllers: [PlacesController, RidesController, DispatchController, AdminRidesController],
  providers: [
    RidesService,
    DispatchService,
    TripService,
    CancellationService,
    AdminRidesService,
    DriverOffersGateway,
    RideTrackingGateway,
  ],
  // DispatchService + DriverOffersGateway exported specifically so
  // LogisticsModule can reuse the shared driver-status state machine and
  // the single per-driver WS connection for delivery offers — see
  // plan.md Section 6: "Logistics reuses dispatch/trip/wallet infra from rides."
  exports: [DispatchService, DriverOffersGateway],
})
export class RidesModule {}
