import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// For public endpoints that do a little more for a signed-in caller (e.g. a
// fare quote that also applies the caller's promo code). A missing or
// invalid token just means "anonymous" — request.user is null, never a 401.
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(_err: unknown, user: TUser): TUser | null {
    return user || null;
  }
}
