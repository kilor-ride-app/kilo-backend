import { Module } from '@nestjs/common';
import { AdminPromoController } from './admin-promo.controller';
import { PromoController } from './promo.controller';
import { PromoService } from './promo.service';

@Module({
  controllers: [PromoController, AdminPromoController],
  providers: [PromoService],
  // Exported so RidesModule/LogisticsModule can apply a promo code at
  // booking time (see plan.md's scope note: this touches fare calculation
  // in both modules — built as a fast-follow, not deferred).
  exports: [PromoService],
})
export class PromoModule {}
