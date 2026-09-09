import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser, JwtPayload } from '../../common/types/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  // Deliberately stateless — no DB lookup per request, matches the
  // scaling design in kilo-backend-plan.md Section 8 (stateless JWT app
  // instances). Endpoints that need a fresh view of the user (e.g. status
  // changes) fetch it explicitly instead of relying on token claims.
  validate(payload: JwtPayload): AuthenticatedUser {
    return { userId: payload.sub, role: payload.role, phone: payload.phone, sid: payload.sid };
  }
}
