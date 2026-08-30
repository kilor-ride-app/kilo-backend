import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
  staffRoles: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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

  async listStaff() {
    return this.prisma.user.findMany({
      where: {
        role: {
          in: [UserRole.SUPPORT_AGENT, UserRole.ADMIN, UserRole.SUPER_ADMIN],
        },
      },
      select: STAFF_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }
}
