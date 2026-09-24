import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommissionRule, Prisma, Tariff, TariffServiceType } from '@prisma/client';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// v2: tariffs gained serviceType/display fields — a new key keeps a cache
// written by the previous release from being read back without them.
const TARIFFS_CACHE_KEY = 'pricing:tariffs:active:v2';
const COMMISSIONS_CACHE_KEY = 'pricing:commissions:active';
const CACHE_TTL_SECONDS = 60 * 60; // long TTL — invalidated explicitly on write, per plan.md Section 9

// Fraction of the post-discount fare added as tax (0.075 = 7.5% VAT).
// Zero until finance sets it, so fares are unchanged by default.
const TAX_RATE_CONFIG_KEY = 'fareTaxRate';

export interface FareBreakdown {
  subtotal: Prisma.Decimal; // tariff fare before promo and tax
  promoDiscount: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal; // what the customer pays
}

export function roundMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly platformConfig: PlatformConfigService,
  ) {}

  // Most specific match wins. Service type outranks area: a PACKAGE tariff
  // for CAR must never price a ride just because it is area-specific.
  // Tariffs with no serviceType apply to every service, which keeps
  // pre-existing tariffs working unchanged.
  async getActiveTariff(
    vehicleType: string,
    serviceAreaId?: string,
    serviceType?: TariffServiceType,
  ): Promise<Tariff> {
    const tariff = this.resolveTariff(
      await this.getActiveTariffs(),
      vehicleType,
      serviceAreaId,
      serviceType,
    );
    if (!tariff) {
      throw new NotFoundException(`No active tariff for vehicle type ${vehicleType}`);
    }
    return tariff;
  }

  // One tariff per vehicle type offered for this service in this area —
  // what the vehicle picker lists. Ordered by the admin-set sortOrder.
  async listActiveTariffsForService(
    serviceType: TariffServiceType,
    serviceAreaId?: string,
  ): Promise<Tariff[]> {
    const tariffs = await this.getActiveTariffs();
    const vehicleTypes = [
      ...new Set(
        tariffs
          .filter((t) => t.serviceType === serviceType || t.serviceType === null)
          .map((t) => t.vehicleType),
      ),
    ];
    return vehicleTypes
      .map((v) => this.resolveTariff(tariffs, v, serviceAreaId, serviceType))
      .filter((t): t is Tariff => t !== undefined)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // Trip time for this vehicle, scaled from the route's driving time.
  estimateTripMinutes(tariff: Tariff, routeDurationMinutes: number): number {
    return Math.max(1, Math.ceil(tariff.durationMultiplier.mul(routeDurationMinutes).toNumber()));
  }

  async getTaxRate(): Promise<Prisma.Decimal> {
    const rate = await this.platformConfig.get<number>(TAX_RATE_CONFIG_KEY, 0);
    return new Prisma.Decimal(rate);
  }

  // subtotal → minus promo → plus tax on what's left. Tax is charged on the
  // discounted amount, since that is what the customer actually pays for.
  async buildFareBreakdown(
    subtotal: Prisma.Decimal,
    promoDiscount: Prisma.Decimal = new Prisma.Decimal(0),
  ): Promise<FareBreakdown> {
    const roundedSubtotal = roundMoney(subtotal);
    const discount = roundMoney(Prisma.Decimal.min(promoDiscount, roundedSubtotal));
    const taxable = roundedSubtotal.minus(discount);
    const tax = roundMoney(taxable.mul(await this.getTaxRate()));
    return {
      subtotal: roundedSubtotal,
      promoDiscount: discount,
      tax,
      total: taxable.plus(tax),
    };
  }

  private resolveTariff(
    tariffs: Tariff[],
    vehicleType: string,
    serviceAreaId?: string,
    serviceType?: TariffServiceType,
  ): Tariff | undefined {
    const area = serviceAreaId ?? null;
    const candidates = tariffs.filter(
      (t) =>
        t.vehicleType === vehicleType &&
        (t.serviceAreaId === area || t.serviceAreaId === null) &&
        (serviceType === undefined || t.serviceType === serviceType || t.serviceType === null),
    );
    const score = (t: Tariff) =>
      (serviceType !== undefined && t.serviceType === serviceType ? 2 : 0) +
      (area !== null && t.serviceAreaId === area ? 1 : 0);
    return candidates.sort((a, b) => score(b) - score(a))[0];
  }

  async getActiveCommissionRate(
    serviceType: string,
    vehicleType?: string,
  ): Promise<CommissionRule> {
    const rules = await this.getActiveCommissionRules();
    const exact = rules.find(
      (r) => r.serviceType === serviceType && r.vehicleType === (vehicleType ?? null),
    );
    const fallback = rules.find((r) => r.serviceType === serviceType && r.vehicleType === null);
    const rule = exact ?? fallback;
    if (!rule) {
      throw new NotFoundException(`No active commission rule for service type ${serviceType}`);
    }
    return rule;
  }

  calculateFare(tariff: Tariff, distanceKm: number, durationMinutes: number): Prisma.Decimal {
    const distanceCost = tariff.perKmRate.mul(distanceKm);
    const timeCost = tariff.perMinuteRate.mul(durationMinutes);
    const fare = tariff.baseFare.plus(distanceCost).plus(timeCost);
    return roundMoney(Prisma.Decimal.max(fare, tariff.minimumFare));
  }

  async listTariffs() {
    return this.prisma.tariff.findMany({
      orderBy: [{ vehicleType: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createTariff(dto: {
    vehicleType: string;
    serviceAreaId?: string;
    serviceType?: TariffServiceType;
    baseFare: number;
    perKmRate: number;
    perMinuteRate: number;
    minimumFare: number;
    cancellationFee: number;
    currency?: string;
    displayName?: string;
    description?: string;
    sortOrder?: number;
    durationMultiplier?: number;
  }) {
    const conflict = await this.prisma.tariff.findFirst({
      where: {
        vehicleType: dto.vehicleType,
        serviceAreaId: dto.serviceAreaId ?? null,
        serviceType: dto.serviceType ?? null,
        isActive: true,
      },
    });
    if (conflict) {
      throw new ConflictException(
        'An active tariff already exists for this vehicle type, service type and service area — deactivate it first',
      );
    }

    const tariff = await this.prisma.tariff.create({ data: dto });
    await this.invalidateTariffCache();
    return tariff;
  }

  async updateTariff(id: string, dto: Partial<Parameters<PricingService['createTariff']>[0]>) {
    await this.findTariffOrThrow(id);
    const tariff = await this.prisma.tariff.update({ where: { id }, data: dto });
    await this.invalidateTariffCache();
    return tariff;
  }

  async deactivateTariff(id: string) {
    await this.findTariffOrThrow(id);
    const tariff = await this.prisma.tariff.update({ where: { id }, data: { isActive: false } });
    await this.invalidateTariffCache();
    return tariff;
  }

  async listCommissionRules() {
    return this.prisma.commissionRule.findMany({
      orderBy: [{ serviceType: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createCommissionRule(dto: { serviceType: string; vehicleType?: string; rate: number }) {
    const conflict = await this.prisma.commissionRule.findFirst({
      where: { serviceType: dto.serviceType, vehicleType: dto.vehicleType ?? null, isActive: true },
    });
    if (conflict) {
      throw new ConflictException(
        'An active commission rule already exists for this service type and vehicle type',
      );
    }
    if (dto.rate < 0 || dto.rate > 1) {
      throw new BadRequestException('rate must be between 0 and 1');
    }

    const rule = await this.prisma.commissionRule.create({ data: dto });
    await this.invalidateCommissionCache();
    return rule;
  }

  async updateCommissionRule(
    id: string,
    dto: Partial<{ serviceType: string; vehicleType?: string; rate: number; isActive: boolean }>,
  ) {
    const existing = await this.prisma.commissionRule.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Commission rule not found');
    }
    const rule = await this.prisma.commissionRule.update({ where: { id }, data: dto });
    await this.invalidateCommissionCache();
    return rule;
  }

  private async findTariffOrThrow(id: string) {
    const tariff = await this.prisma.tariff.findUnique({ where: { id } });
    if (!tariff) {
      throw new NotFoundException('Tariff not found');
    }
    return tariff;
  }

  private async getActiveTariffs(): Promise<Tariff[]> {
    const cached = await this.redis.getJson<Tariff[]>(TARIFFS_CACHE_KEY);
    if (cached) {
      return cached.map((t) => ({
        ...t,
        baseFare: new Prisma.Decimal(t.baseFare),
        perKmRate: new Prisma.Decimal(t.perKmRate),
        perMinuteRate: new Prisma.Decimal(t.perMinuteRate),
        minimumFare: new Prisma.Decimal(t.minimumFare),
        cancellationFee: new Prisma.Decimal(t.cancellationFee),
        durationMultiplier: new Prisma.Decimal(t.durationMultiplier),
      }));
    }
    const tariffs = await this.prisma.tariff.findMany({ where: { isActive: true } });
    await this.redis.setJson(TARIFFS_CACHE_KEY, tariffs, CACHE_TTL_SECONDS);
    return tariffs;
  }

  private async getActiveCommissionRules(): Promise<CommissionRule[]> {
    const cached = await this.redis.getJson<CommissionRule[]>(COMMISSIONS_CACHE_KEY);
    if (cached) {
      return cached.map((r) => ({ ...r, rate: new Prisma.Decimal(r.rate) }));
    }
    const rules = await this.prisma.commissionRule.findMany({ where: { isActive: true } });
    await this.redis.setJson(COMMISSIONS_CACHE_KEY, rules, CACHE_TTL_SECONDS);
    return rules;
  }

  private async invalidateTariffCache() {
    await this.redis.client.del(TARIFFS_CACHE_KEY);
  }

  private async invalidateCommissionCache() {
    await this.redis.client.del(COMMISSIONS_CACHE_KEY);
  }
}
