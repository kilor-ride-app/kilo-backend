import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ResolveTariffQueryDto } from './dto/resolve-tariff-query.dto';
import { PricingService } from './pricing.service';

// Public/unauthenticated on purpose — "internal" per plan.md just means
// "consumed by other backend modules" (Rides/Logistics fare estimation),
// not that it needs its own auth; it carries no user-specific data.
@ApiTags('pricing')
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get('tariffs/active')
  getActiveTariff(@Query() query: ResolveTariffQueryDto) {
    return this.pricing.getActiveTariff(query.vehicleType, query.serviceAreaId);
  }
}
