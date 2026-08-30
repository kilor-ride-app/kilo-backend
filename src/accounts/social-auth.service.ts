import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SocialProvider, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleTokenVerifier } from '../integrations/google/google-token-verifier.service';
import { AppleTokenVerifier } from '../integrations/apple/apple-token-verifier.service';
import { AuthService, TokenPair } from './auth.service';
import { SocialProfile } from './types/social-profile.interface';

export type SocialAuthResult =
  | { status: 'LOGIN'; tokens: TokenPair }
  | { status: 'SIGNUP_REQUIRED'; email: string | null; firstName?: string; lastName?: string };

// Rider-only, per product decision — Google/Apple sign-in never applies to
// driver or staff accounts. A matched existing account that isn't a RIDER
// is rejected rather than silently logged in.
@Injectable()
export class SocialAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly google: GoogleTokenVerifier,
    private readonly apple: AppleTokenVerifier,
  ) {}

  async authenticateGoogle(idToken: string): Promise<SocialAuthResult> {
    return this.authenticate(SocialProvider.GOOGLE, await this.google.verify(idToken));
  }

  async authenticateApple(idToken: string): Promise<SocialAuthResult> {
    return this.authenticate(SocialProvider.APPLE, await this.apple.verify(idToken));
  }

  async completeGoogleSignup(
    idToken: string,
    phone: string,
    firstName?: string,
    lastName?: string,
  ) {
    return this.completeSignup(
      SocialProvider.GOOGLE,
      await this.google.verify(idToken),
      phone,
      firstName,
      lastName,
    );
  }

  async completeAppleSignup(idToken: string, phone: string, firstName: string, lastName: string) {
    return this.completeSignup(
      SocialProvider.APPLE,
      await this.apple.verify(idToken),
      phone,
      firstName,
      lastName,
    );
  }

  private async authenticate(
    provider: SocialProvider,
    profile: SocialProfile,
  ): Promise<SocialAuthResult> {
    const existingIdentity = await this.findIdentity(provider, profile.providerUserId);
    if (existingIdentity) {
      return { status: 'LOGIN', tokens: await this.loginAs(existingIdentity.userId) };
    }

    // Only trust the email for account-linking if the provider itself
    // asserts it's verified — an unverified email claim isn't proof of
    // ownership and can't be used to attach a social identity to an
    // existing account.
    if (profile.email && profile.emailVerified) {
      const existingUser = await this.prisma.user.findUnique({ where: { email: profile.email } });
      if (existingUser) {
        if (existingUser.role !== UserRole.RIDER) {
          throw new ForbiddenException('Social login is only available for rider accounts');
        }
        await this.prisma.socialIdentity.create({
          data: {
            provider,
            providerUserId: profile.providerUserId,
            userId: existingUser.id,
            email: profile.email,
          },
        });
        return { status: 'LOGIN', tokens: await this.loginAs(existingUser.id) };
      }
    }

    return {
      status: 'SIGNUP_REQUIRED',
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
    };
  }

  private async completeSignup(
    provider: SocialProvider,
    profile: SocialProfile,
    phone: string,
    firstName?: string,
    lastName?: string,
  ) {
    // Re-verified the token fresh above; re-check for a race — someone else
    // may have completed this same signup between the initial call and now.
    const existingIdentity = await this.findIdentity(provider, profile.providerUserId);
    if (existingIdentity) {
      return this.loginAs(existingIdentity.userId);
    }

    const resolvedFirstName = firstName ?? profile.firstName;
    const resolvedLastName = lastName ?? profile.lastName;
    if (!resolvedFirstName || !resolvedLastName) {
      throw new BadRequestException('firstName and lastName are required');
    }

    const phoneTaken = await this.prisma.user.findUnique({ where: { phone } });
    if (phoneTaken) {
      throw new ConflictException('An account with this phone number already exists');
    }
    if (profile.email) {
      const emailTaken = await this.prisma.user.findUnique({ where: { email: profile.email } });
      if (emailTaken) {
        throw new ConflictException('An account with this email already exists');
      }
    }

    const user = await this.prisma.user.create({
      data: {
        firstName: resolvedFirstName,
        lastName: resolvedLastName,
        phone,
        email: profile.email,
        // Trust the provider's own verification claim — same reasoning as account-linking above.
        emailVerifiedAt: profile.email && profile.emailVerified ? new Date() : null,
        role: UserRole.RIDER,
        // Same invariant as every other account: phone still needs OTP
        // verification before the account is usable, however it was created.
        status: UserStatus.PENDING_VERIFICATION,
      },
    });
    await this.prisma.socialIdentity.create({
      data: {
        provider,
        providerUserId: profile.providerUserId,
        userId: user.id,
        email: profile.email,
      },
    });

    await this.authService.sendRegistrationOtp(user.id, user.phone);
    return { userId: user.id, message: 'Verification code sent' };
  }

  private findIdentity(provider: SocialProvider, providerUserId: string) {
    return this.prisma.socialIdentity.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } },
    });
  }

  private async loginAs(userId: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.authService.issueTokenPair(user.id, user.role, user.phone);
  }
}
