import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PartnerOfferAudience, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

function audienceForRole(role: UserRole): PartnerOfferAudience[] {
  const specific =
    role === UserRole.DRIVER ? PartnerOfferAudience.DRIVER : PartnerOfferAudience.RIDER;
  return [specific, PartnerOfferAudience.BOTH];
}

@Injectable()
export class PartnerOffersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(role: UserRole) {
    const now = new Date();
    return this.prisma.partnerOffer.findMany({
      where: {
        isActive: true,
        audience: { in: audienceForRole(role) },
        OR: [{ validFrom: null }, { validFrom: { lte: now } }],
        AND: [{ OR: [{ validUntil: null }, { validUntil: { gte: now } }] }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDetail(id: string) {
    const offer = await this.prisma.partnerOffer.findUnique({ where: { id } });
    if (!offer) {
      throw new NotFoundException('Partner offer not found');
    }
    return offer;
  }

  async claim(offerId: string, userId: string) {
    await this.getDetail(offerId);
    const existing = await this.prisma.partnerOfferClaim.findUnique({
      where: { offerId_userId: { offerId, userId } },
    });
    if (existing) {
      throw new ConflictException('You have already claimed this offer');
    }
    return this.prisma.partnerOfferClaim.create({ data: { offerId, userId } });
  }

  async create(dto: {
    title: string;
    description: string;
    partnerName: string;
    audience?: PartnerOfferAudience;
    validFrom?: string;
    validUntil?: string;
  }) {
    return this.prisma.partnerOffer.create({
      data: {
        ...dto,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
      },
    });
  }

  async update(
    id: string,
    dto: Partial<{
      title: string;
      description: string;
      partnerName: string;
      audience: PartnerOfferAudience;
      isActive: boolean;
      validFrom: string;
      validUntil: string;
    }>,
  ) {
    await this.getDetail(id);
    const { validFrom, validUntil, ...rest } = dto;
    return this.prisma.partnerOffer.update({
      where: { id },
      data: {
        ...rest,
        ...(validFrom ? { validFrom: new Date(validFrom) } : {}),
        ...(validUntil ? { validUntil: new Date(validUntil) } : {}),
      },
    });
  }

  async getClaims(id: string) {
    await this.getDetail(id);
    const [claims, count] = await Promise.all([
      this.prisma.partnerOfferClaim.findMany({
        where: { offerId: id },
        orderBy: { claimedAt: 'desc' },
      }),
      this.prisma.partnerOfferClaim.count({ where: { offerId: id } }),
    ]);
    return { totalClaims: count, claims };
  }
}
