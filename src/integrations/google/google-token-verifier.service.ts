import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { SocialProfile } from '../../accounts/types/social-profile.interface';

@Injectable()
export class GoogleTokenVerifier {
  private readonly client = new OAuth2Client();
  private readonly audiences: string[];

  constructor(private readonly config: ConfigService) {
    this.audiences = (this.config.get<string>('GOOGLE_OAUTH_CLIENT_IDS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async verify(idToken: string): Promise<SocialProfile> {
    if (this.audiences.length === 0) {
      throw new ServiceUnavailableException('Google sign-in is not configured');
    }

    let payload;
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.audiences });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google ID token');
    }
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid Google ID token');
    }

    return {
      providerUserId: payload.sub,
      email: payload.email ?? null,
      emailVerified: payload.email_verified ?? false,
      firstName: payload.given_name,
      lastName: payload.family_name,
    };
  }
}
