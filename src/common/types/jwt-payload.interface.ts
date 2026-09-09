import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  role: UserRole;
  phone: string;
  // Session id — the RefreshToken row this access token was issued
  // alongside. Absent on tokens minted before session tracking landed.
  sid?: string;
}

export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
  phone: string;
  sid?: string;
}

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}
