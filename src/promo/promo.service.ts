import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PromoApplicableService, PromoType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface ValidateResult {
  promoId: string;
  discountAmount: Prisma.Decimal;
  finalAmount: Prisma.Decimal;
}

@Injectable()
export class PromoService {
  constructor(private readonly prisma: PrismaService) {}

  // Home-screen banner: live, featured promos, soonest-expiring first.
  // Doesn't check per-user eligibility — tapping through goes via
  // POST /promos/validate, which does.
  async listFeatured() {
    const now = new Date();
    return this.prisma.promo.findMany({
      where: {
        isActive: true,
        isFeatured: true,
        validFrom: { lte: now },
        validUntil: { gte: now },
      },
      select: {
        id: true,
        code: true,
        title: true,
        subtitle: true,
        imageUrl: true,
        type: true,
        value: true,
        maxDiscount: true,
        applicableServices: true,
        validUntil: true,
      },
      orderBy: { validUntil: 'asc' },
      take: 10,
    });
  }

  // Pure computation + eligibility check — never records a redemption.
  // Called both by POST /promos/validate (a draft-booking preview with no
  // side effects) and internally by RidesService/LogisticsService right
  // before creating a real booking.
  async validate(
    code: string,
    service: PromoApplicableService,
    fareAmount: Prisma.Decimal,
    userId: string,
  ): Promise<ValidateResult> {
    const promo = await this.prisma.promo.findUnique({ where: { code: code.toUpperCase() } });
    if (!promo || !promo.isActive) {
      throw new NotFoundException('Promo code not found');
    }
    const now = new Date();
    if (now < promo.validFrom || now > promo.validUntil) {
      throw new BadRequestException('This promo code is not currently valid');
    }
    if (!promo.applicableServices.includes(service)) {
      throw new BadRequestException(`This promo code does not apply to ${service}`);
    }

    if (promo.usageLimitTotal) {
      const totalRedemptions = await this.prisma.promoRedemption.count({
        where: { promoId: promo.id },
      });
      if (totalRedemptions >= promo.usageLimitTotal) {
        throw new ConflictException('This promo code has reached its usage limit');
      }
    }
    if (promo.usageLimitPerUser) {
      const userRedemptions = await this.prisma.promoRedemption.count({
        where: { promoId: promo.id, userId },
      });
      if (userRedemptions >= promo.usageLimitPerUser) {
        throw new ConflictException(
          'You have already used this promo code the maximum number of times',
        );
      }
    }

    let discountAmount: Prisma.Decimal;
    if (promo.type === PromoType.PERCENTAGE) {
      discountAmount = fareAmount.mul(promo.value).dividedBy(100);
      if (promo.maxDiscount && discountAmount.greaterThan(promo.maxDiscount)) {
        discountAmount = promo.maxDiscount;
      }
    } else {
      discountAmount = Prisma.Decimal.min(promo.value, fareAmount);
    }

    return { promoId: promo.id, discountAmount, finalAmount: fareAmount.minus(discountAmount) };
  }

  // Records the redemption — called only once a booking has actually been
  // created with the discount applied, never from the validate-only preview.
  async recordRedemption(
    promoId: string,
    userId: string,
    service: PromoApplicableService,
    referenceId: string,
    discountAmount: Prisma.Decimal,
  ) {
    return this.prisma.promoRedemption.create({
      data: { promoId, userId, service, referenceId, discountAmount },
    });
  }

  async myRedemptions(userId: string, take = 50, skip = 0) {
    return this.prisma.promoRedemption.findMany({
      where: { userId },
      include: { promo: { select: { code: true, type: true } } },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  async createPromo(dto: {
    code: string;
    type: PromoType;
    value: number;
    maxDiscount?: number;
    usageLimitTotal?: number;
    usageLimitPerUser?: number;
    validFrom: string;
    validUntil: string;
    applicableServices: PromoApplicableService[];
    isFeatured?: boolean;
    title?: string;
    subtitle?: string;
    imageUrl?: string;
  }) {
    const existing = await this.prisma.promo.findUnique({
      where: { code: dto.code.toUpperCase() },
    });
    if (existing) {
      throw new ConflictException('A promo with this code already exists');
    }
    return this.prisma.promo.create({
      data: {
        ...dto,
        code: dto.code.toUpperCase(),
        validFrom: new Date(dto.validFrom),
        validUntil: new Date(dto.validUntil),
      },
    });
  }

  async listPromos() {
    return this.prisma.promo.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async updatePromo(
    id: string,
    dto: Partial<{
      value: number;
      maxDiscount: number;
      usageLimitTotal: number;
      usageLimitPerUser: number;
      validFrom: string;
      validUntil: string;
      applicableServices: PromoApplicableService[];
      isActive: boolean;
      isFeatured: boolean;
      title: string;
      subtitle: string;
      imageUrl: string;
    }>,
  ) {
    await this.findPromoOrThrow(id);
    const { validFrom, validUntil, ...rest } = dto;
    return this.prisma.promo.update({
      where: { id },
      data: {
        ...rest,
        ...(validFrom ? { validFrom: new Date(validFrom) } : {}),
        ...(validUntil ? { validUntil: new Date(validUntil) } : {}),
      },
    });
  }

  async deletePromo(id: string) {
    await this.findPromoOrThrow(id);
    await this.prisma.promo.delete({ where: { id } });
    return { deleted: true };
  }

  async getRedemptionStats(id: string) {
    await this.findPromoOrThrow(id);
    const [redemptions, agg] = await Promise.all([
      this.prisma.promoRedemption.findMany({
        where: { promoId: id },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.promoRedemption.aggregate({
        where: { promoId: id },
        _count: true,
        _sum: { discountAmount: true },
      }),
    ]);
    return {
      totalRedemptions: agg._count,
      totalDiscountIssued: agg._sum.discountAmount ?? 0,
      redemptions,
    };
  }

  private async findPromoOrThrow(id: string) {
    const promo = await this.prisma.promo.findUnique({ where: { id } });
    if (!promo) {
      throw new NotFoundException('Promo not found');
    }
    return promo;
  }
}
