import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { R2Service } from '../integrations/r2/r2.service';
import { PrismaService } from '../prisma/prisma.service';
import { StaffStatusFilter } from './dto/list-staff-query.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60;

const PUBLIC_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  emailVerifiedAt: true,
  pendingEmail: true,
  phone: true,
  role: true,
  status: true,
  profilePhotoUrl: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

const STAFF_SELECT = {
  ...PUBLIC_USER_SELECT,
  staffRoles: { select: { id: true, name: true, permissions: { select: { key: true } } } },
  directPermissions: { select: { key: true } },
} satisfies Prisma.UserSelect;

const STAFF_ROLES: UserRole[] = [UserRole.SUPPORT_AGENT, UserRole.ADMIN, UserRole.SUPER_ADMIN];

// The doc's "INACTIVE" has no dedicated account state — it collapses onto
// SUSPENDED (a de-provisioned / disabled staff account).
function toUserStatus(filter: StaffStatusFilter): UserStatus {
  return filter === 'ACTIVE' ? UserStatus.ACTIVE : UserStatus.SUSPENDED;
}

type StaffRow = Prisma.UserGetPayload<{ select: typeof STAFF_SELECT }>;

// Flattens role + direct permissions into the effective set the
// PermissionsGuard would grant this user.
function withEffectivePermissions(staff: StaffRow) {
  const keys = new Set<string>();
  for (const role of staff.staffRoles) {
    for (const p of role.permissions) {
      keys.add(p.key);
    }
  }
  for (const p of staff.directPermissions) {
    keys.add(p.key);
  }
  return {
    ...staff,
    staffRoles: staff.staffRoles.map((r) => ({ id: r.id, name: r.name })),
    directPermissions: staff.directPermissions.map((p) => p.key),
    effectivePermissions: [...keys].sort(),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly r2: R2Service,
    private readonly config: ConfigService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PUBLIC_USER_SELECT,
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async updateProfile(
    userId: string,
    data: { firstName?: string; lastName?: string; profilePhotoUrl?: string },
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: PUBLIC_USER_SELECT,
    });
  }

  // Direct multipart upload to R2 — same pattern as KycService.uploadDocument.
  // When R2_PUBLIC_BASE_URL is set (public bucket / CDN domain) we store a
  // stable public URL; otherwise we fall back to a long-lived signed URL.
  async setAvatar(userId: string, file: Express.Multer.File) {
    const key = `avatars/${userId}/${randomUUID()}-${file.originalname}`;
    await this.r2.uploadObject(key, file.buffer, file.mimetype);

    const publicBase = this.config.get<string>('R2_PUBLIC_BASE_URL');
    const profilePhotoUrl = publicBase
      ? `${publicBase.replace(/\/$/, '')}/${key}`
      : await this.r2.getSignedReadUrl(key, ONE_WEEK_SECONDS);

    await this.prisma.user.update({ where: { id: userId }, data: { profilePhotoUrl } });
    return { profilePhotoUrl };
  }

  async listStaff(status?: StaffStatusFilter) {
    const staff = await this.prisma.user.findMany({
      where: {
        role: { in: STAFF_ROLES },
        ...(status ? { status: toUserStatus(status) } : {}),
      },
      select: STAFF_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return staff.map(withEffectivePermissions);
  }

  async updateStaff(id: string, dto: UpdateStaffDto, actorId: string) {
    const target = await this.prisma.user.findFirst({
      where: { id, role: { in: STAFF_ROLES } },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException('Staff member not found');
    }

    const data: Prisma.UserUpdateInput = {};

    if (dto.roleIds) {
      const roles = await this.prisma.role.findMany({
        where: { id: { in: dto.roleIds } },
        select: { id: true },
      });
      if (roles.length !== dto.roleIds.length) {
        throw new BadRequestException('One or more role IDs were not found');
      }
      data.staffRoles = { set: roles.map((r) => ({ id: r.id })) };
    }

    if (dto.permissionKeys) {
      const perms = await this.prisma.permission.findMany({
        where: { key: { in: dto.permissionKeys } },
        select: { id: true, key: true },
      });
      if (perms.length !== dto.permissionKeys.length) {
        const found = new Set(perms.map((p) => p.key));
        const missing = dto.permissionKeys.filter((k) => !found.has(k));
        throw new BadRequestException(`Unknown permission key(s): ${missing.join(', ')}`);
      }
      data.directPermissions = { set: perms.map((p) => ({ id: p.id })) };
    }

    if (dto.status) {
      data.status = toUserStatus(dto.status);
      // Disabling an account kills its live sessions.
      if (data.status === UserStatus.SUSPENDED) {
        await this.prisma.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: STAFF_SELECT,
    });
    await this.audit.record(actorId, 'staff.update', 'User', id, {
      roleIds: dto.roleIds,
      status: dto.status,
      permissionKeys: dto.permissionKeys,
    });
    return withEffectivePermissions(updated);
  }

  // De-provision — hard delete is impossible (audit logs, tickets, invites
  // all FK this user). Disables the account, strips every grant, and
  // revokes all sessions.
  async deprovisionStaff(id: string, actorId: string) {
    const target = await this.prisma.user.findFirst({
      where: { id, role: { in: STAFF_ROLES } },
      select: { id: true, role: true },
    });
    if (!target) {
      throw new NotFoundException('Staff member not found');
    }
    if (target.role === UserRole.SUPER_ADMIN) {
      throw new BadRequestException('A super admin account cannot be de-provisioned here');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          status: UserStatus.SUSPENDED,
          staffRoles: { set: [] },
          directPermissions: { set: [] },
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record(actorId, 'staff.deprovision', 'User', id);
    return { deprovisioned: true };
  }
}
