import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { AuthenticatedUser } from '../types/jwt-payload.interface';

// Runs after JwtAuthGuard. Unlike RolesGuard (coarse tier, checked straight
// off the JWT claim), this checks the fine-grained Role/Permission tables —
// necessarily a DB read, since permission grants can change without a new
// token being issued. Acceptable cost: this guard only ever sits on
// low-volume admin-side routes, never the rider/driver hot path.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const user: AuthenticatedUser = context.switchToHttp().getRequest().user;
    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }
    if (user.role === UserRole.SUPER_ADMIN) {
      return true; // root tier — always has every permission
    }

    const grantedKeys = await this.prisma.permission.findMany({
      where: { roles: { some: { users: { some: { id: user.userId } } } } },
      select: { key: true },
    });
    const granted = new Set(grantedKeys.map((p) => p.key));

    const missing = requiredPermissions.filter((key) => !granted.has(key));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing required permission(s): ${missing.join(', ')}`);
    }
    return true;
  }
}
