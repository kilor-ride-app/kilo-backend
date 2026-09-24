import { HttpException, Injectable } from '@nestjs/common';
import { Prisma, PromoApplicableService, Tariff, TariffServiceType } from '@prisma/client';
import { PromoService } from '../promo/promo.service';
import { FareBreakdown, PricingService } from './pricing.service';

export interface QuotePromoInput {
  code: string;
  userId: string;
  service: PromoApplicableService;
}

export interface VehicleQuote {
  vehicleType: string;
  displayName: string;
  description: string | null;
  currency: string;
  subtotal: Prisma.Decimal;
  promoDiscount: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
  // Kept as an alias of `total` so existing clients reading estimatedFare
  // see what will actually be charged.
  estimatedFare: Prisma.Decimal;
  tripMinutes: number;
  recommended: boolean;
}

export interface PromoOutcome {
  code: string;
  applied: boolean;
  message?: string; // why it didn't apply, when applied = false
}

// Prices one route across vehicle options with the same promo + tax rules
// used at booking time, so what the picker shows is what gets charged.
@Injectable()
export class QuoteService {
  constructor(
    private readonly pricing: PricingService,
    private readonly promo: PromoService,
  ) {}

  async quoteVehicles(params: {
    serviceType: TariffServiceType;
    serviceAreaId?: string;
    distanceKm: number;
    durationMinutes: number;
    vehicleType?: string; // price just this one
    promo?: QuotePromoInput;
  }): Promise<{ quotes: VehicleQuote[]; promo?: PromoOutcome }> {
    const tariffs = params.vehicleType
      ? [
          await this.pricing.getActiveTariff(
            params.vehicleType,
            params.serviceAreaId,
            params.serviceType,
          ),
        ]
      : await this.pricing.listActiveTariffsForService(params.serviceType, params.serviceAreaId);

    let promoOutcome: PromoOutcome | undefined;
    const quotes: VehicleQuote[] = [];
    for (const tariff of tariffs) {
      const subtotal = this.pricing.calculateFare(
        tariff,
        params.distanceKm,
        params.durationMinutes,
      );
      let discount = new Prisma.Decimal(0);
      if (params.promo) {
        const result = await this.tryPromo(params.promo, subtotal);
        promoOutcome ??= { code: params.promo.code.toUpperCase(), ...result.outcome };
        discount = result.discount;
      }
      const breakdown = await this.pricing.buildFareBreakdown(subtotal, discount);
      quotes.push(this.toQuote(tariff, breakdown, params.durationMinutes));
    }

    // Cheapest is recommended — same rule the delivery quote always used.
    const cheapest = quotes.reduce<VehicleQuote | undefined>(
      (min, q) => (!min || q.total.lessThan(min.total) ? q : min),
      undefined,
    );
    if (cheapest) cheapest.recommended = true;

    return { quotes, promo: promoOutcome };
  }

  private toQuote(tariff: Tariff, fare: FareBreakdown, routeMinutes: number): VehicleQuote {
    return {
      vehicleType: tariff.vehicleType,
      displayName: tariff.displayName ?? tariff.vehicleType,
      description: tariff.description,
      currency: tariff.currency,
      subtotal: fare.subtotal,
      promoDiscount: fare.promoDiscount,
      tax: fare.tax,
      total: fare.total,
      estimatedFare: fare.total,
      tripMinutes: this.pricing.estimateTripMinutes(tariff, routeMinutes),
      recommended: false,
    };
  }

  // A promo that doesn't apply shouldn't fail the whole quote — the picker
  // still needs prices. Its rejection reason is surfaced instead.
  private async tryPromo(promo: QuotePromoInput, fare: Prisma.Decimal) {
    try {
      const result = await this.promo.validate(promo.code, promo.service, fare, promo.userId);
      return { discount: result.discountAmount, outcome: { applied: true } };
    } catch (err) {
      if (err instanceof HttpException) {
        return {
          discount: new Prisma.Decimal(0),
          outcome: { applied: false, message: err.message },
        };
      }
      throw err;
    }
  }
}
