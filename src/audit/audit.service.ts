import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditLogFilters {
  action?: string;
  targetType?: string;
  actorId?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    actorId: string | null,
    action: string,
    targetType: string,
    targetId?: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    await this.prisma.auditLog.create({
      data: { actorId, action, targetType, targetId, metadata },
    });
  }

  async list(filters: AuditLogFilters = {}, take = 50, skip = 0) {
    const createdAt =
      filters.from || filters.to
        ? {
            ...(filters.from ? { gte: new Date(filters.from) } : {}),
            ...(filters.to ? { lte: new Date(filters.to) } : {}),
          }
        : undefined;

    const where: Prisma.AuditLogWhereInput = {
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.targetType ? { targetType: filters.targetType } : {}),
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(createdAt ? { createdAt } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total };
  }
}
