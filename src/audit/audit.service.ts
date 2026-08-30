import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

  async list(take = 50, skip = 0) {
    return this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take, skip });
  }
}
