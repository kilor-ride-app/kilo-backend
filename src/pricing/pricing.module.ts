import { Module } from '@nestjs/common';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { PromoModule } from '../promo/promo.module';
import { AdminPricingController } from './admin-pricing.controller';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { QuoteService } from './quote.service';

@Module({
  imports: [PlatformConfigModule, PromoModule],
  controllers: [PricingController, AdminPricingController],
  providers: [PricingService, QuoteService],
  exports: [PricingService, QuoteService],
})
export class PricingModule {}
