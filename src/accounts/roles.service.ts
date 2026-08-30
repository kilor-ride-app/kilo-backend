import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async listRoles() {
    return this.prisma.role.findMany({
      select: { id: true, name: true, description: true, permissions: { select: { key: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async listPermissions() {
    return this.prisma.permission.findMany({
      select: { key: true, description: true },
      orderBy: { key: 'asc' },
    });
  }

  // Composing existing (code-defined, seeded) permissions into a named role —
  // not for inventing new permission keys ad hoc, since a permission with no
  // corresponding @RequirePermissions() check anywhere has no actual effect.
  async createRole(dto: { name: string; description?: string; permissionKeys: string[] }) {
    const existing = await this.prisma.role.findUnique({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException('A role with this name already exists');
    }

    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: dto.permissionKeys } },
    });
    if (permissions.length !== dto.permissionKeys.length) {
      const found = new Set(permissions.map((p) => p.key));
      const missing = dto.permissionKeys.filter((k) => !found.has(k));
      throw new BadRequestException(`Unknown permission key(s): ${missing.join(', ')}`);
    }

    return this.prisma.role.create({
      data: {
        name: dto.name,
        description: dto.description,
        permissions: { connect: permissions.map((p) => ({ id: p.id })) },
      },
      select: { id: true, name: true, description: true, permissions: { select: { key: true } } },
    });
  }
}
