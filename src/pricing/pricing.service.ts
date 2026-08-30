import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommissionRule, Prisma, Tariff } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const TARIFFS_CACHE_KEY = 'pricing:tariffs:active';
const COMMISSIONS_CACHE_KEY = 'pricing:commissions:active';
const CACHE_TTL_SECONDS = 60 * 60; // long TTL — invalidated explicitly on write, per plan.md Section 9

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // Exact (vehicleType, serviceAreaId) match first, falling back to the
  // area-less default tariff for that vehicle type if one exists.
  async getActiveTariff(vehicleType: string, serviceAreaId?: string): Promise<Tariff> {
    const tariffs = await this.getActiveTariffs();
    const exact = tariffs.find(
      (t) => t.vehicleType === vehicleType && t.serviceAreaId === (serviceAreaId ?? null),
    );
    const fallback = tariffs.find((t) => t.vehicleType === vehicleType && t.serviceAreaId === null);
    const tariff = exact ?? fallback;
    if (!tariff) {
      throw new NotFoundException(`No active tariff for vehicle type ${vehicleType}`);
    }
    return tariff;
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
    return Prisma.Decimal.max(fare, tariff.minimumFare);
  }

  async listTariffs() {
    return this.prisma.tariff.findMany({
      orderBy: [{ vehicleType: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createTariff(dto: {
    vehicleType: string;
    serviceAreaId?: string;
    baseFare: number;
    perKmRate: number;
    perMinuteRate: number;
    minimumFare: number;
    cancellationFee: number;
    currency?: string;
  }) {
    const conflict = await this.prisma.tariff.findFirst({
      where: {
        vehicleType: dto.vehicleType,
        serviceAreaId: dto.serviceAreaId ?? null,
        isActive: true,
      },
    });
    if (conflict) {
      throw new ConflictException(
        'An active tariff already exists for this vehicle type and service area — deactivate it first',
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
