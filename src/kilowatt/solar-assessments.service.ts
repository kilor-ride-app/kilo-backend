import { Injectable, NotFoundException } from '@nestjs/common';
import { SolarLeadStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SolarAssessmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(
    userId: string,
    dto: {
      address: string;
      lat?: number;
      lng?: number;
      monthlyBillEstimate?: number;
      propertyType?: string;
      notes?: string;
    },
  ) {
    return this.prisma.solarAssessment.create({ data: { userId, ...dto } });
  }

  async listLeads(status?: SolarLeadStatus, take = 50, skip = 0) {
    return this.prisma.solarAssessment.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  async updateLead(id: string, dto: { status?: SolarLeadStatus; assignedRepId?: string }) {
    const lead = await this.prisma.solarAssessment.findUnique({ where: { id } });
    if (!lead) {
      throw new NotFoundException('Solar lead not found');
    }
    return this.prisma.solarAssessment.update({ where: { id }, data: dto });
  }
}
