import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SolarAssessment, SolarLeadStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface CreateLeadInput {
  name: string;
  phone: string;
  email?: string;
  location: string;
  propertyType?: string;
  systemSize?: number;
  energyNeed?: string;
  status?: SolarLeadStatus;
  assignedToId?: string;
}

interface UpdateLeadInput {
  name?: string;
  phone?: string;
  email?: string;
  location?: string;
  propertyType?: string;
  systemSize?: number;
  energyNeed?: string;
  status?: SolarLeadStatus;
  assignedToId?: string;
}

// Storage columns → dashboard-facing shape (the doc uses flat contact
// fields / `location` / `systemSize` / `assignedToId`).
export function toSolarLeadView(lead: SolarAssessment & { assignedRep?: unknown; user?: unknown }) {
  return {
    ...lead,
    name: lead.contactName,
    phone: lead.contactPhone,
    email: lead.contactEmail,
    location: lead.address,
    systemSize: lead.systemSizeKw,
    assignedToId: lead.assignedRepId,
  };
}

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
    const leads = await this.prisma.solarAssessment.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: {
        assignedRep: { select: { id: true, firstName: true, lastName: true } },
        user: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
      },
    });
    return leads.map(toSolarLeadView);
  }

  async createLead(dto: CreateLeadInput) {
    if (dto.assignedToId) {
      await this.assertStaff(dto.assignedToId);
    }
    const lead = await this.prisma.solarAssessment.create({
      data: {
        address: dto.location,
        contactName: dto.name,
        contactPhone: dto.phone,
        contactEmail: dto.email,
        propertyType: dto.propertyType,
        systemSizeKw: dto.systemSize,
        energyNeed: dto.energyNeed,
        status: dto.status ?? SolarLeadStatus.NEW,
        assignedRepId: dto.assignedToId,
      },
    });
    return toSolarLeadView(lead);
  }

  async updateLead(id: string, dto: UpdateLeadInput) {
    const lead = await this.prisma.solarAssessment.findUnique({ where: { id } });
    if (!lead) {
      throw new NotFoundException('Solar lead not found');
    }
    if (dto.assignedToId) {
      await this.assertStaff(dto.assignedToId);
    }

    const data: Prisma.SolarAssessmentUpdateInput = {
      ...(dto.name !== undefined ? { contactName: dto.name } : {}),
      ...(dto.phone !== undefined ? { contactPhone: dto.phone } : {}),
      ...(dto.email !== undefined ? { contactEmail: dto.email } : {}),
      ...(dto.location !== undefined ? { address: dto.location } : {}),
      ...(dto.propertyType !== undefined ? { propertyType: dto.propertyType } : {}),
      ...(dto.systemSize !== undefined ? { systemSizeKw: dto.systemSize } : {}),
      ...(dto.energyNeed !== undefined ? { energyNeed: dto.energyNeed } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.assignedToId !== undefined
        ? { assignedRep: { connect: { id: dto.assignedToId } } }
        : {}),
    };

    const updated = await this.prisma.solarAssessment.update({ where: { id }, data });
    return toSolarLeadView(updated);
  }

  async deleteLead(id: string) {
    const lead = await this.prisma.solarAssessment.findUnique({ where: { id } });
    if (!lead) {
      throw new NotFoundException('Solar lead not found');
    }
    await this.prisma.solarAssessment.delete({ where: { id } });
    return { deleted: true };
  }

  private async assertStaff(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw new BadRequestException('assignedToId does not match any user');
    }
  }
}
