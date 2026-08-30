import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { SocialProfile } from '../../accounts/types/social-profile.interface';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URI = 'https://appleid.apple.com/auth/keys';

@Injectable()
export class AppleTokenVerifier {
  private readonly jwks = jwksClient({
    jwksUri: APPLE_JWKS_URI,
    cache: true,
    cacheMaxAge: 24 * 60 * 60 * 1000,
  });
  private readonly audience?: string;

  constructor(private readonly config: ConfigService) {
    this.audience = this.config.get<string>('APPLE_CLIENT_ID') || undefined;
  }

  async verify(idToken: string): Promise<SocialProfile> {
    if (!this.audience) {
      throw new ServiceUnavailableException('Apple sign-in is not configured');
    }

    const payload = await new Promise<jwt.JwtPayload>((resolve, reject) => {
      jwt.verify(
        idToken,
        (header, callback) => {
          this.jwks.getSigningKey(header.kid, (err, key) => {
            if (err || !key) {
              callback(err ?? new Error('Signing key not found'));
              return;
            }
            callback(null, key.getPublicKey());
          });
        },
        { issuer: APPLE_ISSUER, audience: this.audience, algorithms: ['RS256'] },
        (err, decoded) => {
          if (err || !decoded || typeof decoded === 'string') {
            reject(err ?? new Error('Invalid Apple ID token'));
            return;
          }
          resolve(decoded);
        },
      );
    }).catch(() => {
      throw new UnauthorizedException('Invalid Apple ID token');
    });

    if (!payload.sub) {
      throw new UnauthorizedException('Invalid Apple ID token');
    }

    return {
      providerUserId: payload.sub,
      email: (payload.email as string | undefined) ?? null,
      // Apple sometimes sends this as the string "true"/"false" rather than a boolean.
      emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    };
  }
}
