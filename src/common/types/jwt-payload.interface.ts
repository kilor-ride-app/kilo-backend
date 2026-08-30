import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  role: UserRole;
  phone: string;
}

export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
  phone: string;
}
