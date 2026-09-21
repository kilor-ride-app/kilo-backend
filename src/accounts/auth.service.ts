import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../integrations/email/email.service';
import { SmsService } from '../integrations/sms/sms.service';
import { parseDuration } from '../common/utils/duration.util';
import { generateSecureToken, hashToken } from '../common/utils/token.util';
import { describeUserAgent } from '../common/utils/user-agent.util';
import { RequestContext } from '../common/types/jwt-payload.interface';
import { EmailVerificationService } from './email-verification.service';
import { OtpService } from './otp.service';
import { OtpPurpose } from './types/otp-purpose.enum';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
    private readonly email: EmailService,
    private readonly otp: OtpService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  async registerRider(dto: {
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
    password: string;
  }) {
    return this.register(dto, UserRole.RIDER);
  }

  async registerDriver(dto: {
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
    password: string;
  }) {
    return this.register(dto, UserRole.DRIVER);
  }

  private async register(
    dto: {
      firstName: string;
      lastName: string;
      phone: string;
      email?: string;
      password: string;
    },
    role: UserRole,
  ) {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ phone: dto.phone }, ...(dto.email ? [{ email: dto.email }] : [])],
      },
    });
    if (existing) {
      throw new ConflictException('An account with this phone or email already exists');
    }

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        email: dto.email,
        passwordHash,
        role,
        status: UserStatus.PENDING_VERIFICATION,
      },
    });

    await this.issueOtp(user.id, user.phone, OtpPurpose.REGISTRATION);
    if (user.email) {
      // Non-blocking — phone verification is what gates account activation;
      // email verification is supplementary and can happen whenever.
      await this.emailVerification.sendForAddress(user.id, user.email);
    }

    return { userId: user.id, message: 'Verification code sent' };
  }

  async sendOtp(phone: string, purpose: OtpPurpose) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      // Same response either way — don't reveal whether a phone number is registered.
      return {
        message: 'If the account exists, a verification code has been sent',
      };
    }
    if (purpose === OtpPurpose.LOGIN && user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Account is not active');
    }

    await this.issueOtp(user.id, user.phone, purpose);
    return {
      message: 'If the account exists, a verification code has been sent',
    };
  }

  // Public: reused by SocialAuthService after creating a user from a
  // completed Google/Apple signup — phone still needs OTP verification
  // regardless of how the account was created.
  async sendRegistrationOtp(userId: string, phone: string) {
    await this.issueOtp(userId, phone, OtpPurpose.REGISTRATION);
  }

  private async issueOtp(userId: string, phone: string, purpose: OtpPurpose) {
    const code = await this.otp.generateAndStore(userId, purpose);
    await this.sms.sendOtp(phone, code);
  }

  async verifyOtp(
    phone: string,
    code: string,
    purpose: OtpPurpose,
    context?: RequestContext,
  ): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      throw new UnauthorizedException('Invalid code');
    }

    await this.otp.verify(user.id, purpose, code);

    if (purpose === OtpPurpose.REGISTRATION && user.status === UserStatus.PENDING_VERIFICATION) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { status: UserStatus.ACTIVE },
      });
    }

    return this.issueTokenPair(user.id, user.role, user.phone, context);
  }

  async login(identifier: string, password: string, context?: RequestContext): Promise<TokenPair> {
    const isEmail = identifier.includes('@');
    const user = isEmail
      ? await this.prisma.user.findUnique({ where: { email: identifier } })
      : await this.prisma.user.findUnique({ where: { phone: identifier } });

    // Same error for "no such user" and "wrong password" — don't help an
    // attacker distinguish valid accounts from invalid ones.
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Account is not active — verify your phone number first');
    }
    const passwordValid = await argon2.verify(user.passwordHash, password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokenPair(user.id, user.role, user.phone, context);
  }

  // Authenticated password change — distinct from the OTP-gated
  // /auth/password/reset flow. Verifies the current password, then rotates
  // the hash and burns every OTHER session (the caller keeps theirs).
  async changePassword(
    userId: string,
    dto: { currentPassword: string; newPassword: string; confirmPassword: string },
    currentSessionId?: string,
  ) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('newPassword and confirmPassword do not match');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) {
      throw new BadRequestException('This account has no password set');
    }
    const valid = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!valid) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must be different from the current one');
    }

    const passwordHash = await argon2.hash(dto.newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
        },
        data: { revokedAt: new Date() },
      }),
    ]);

    return {
      success: true,
      message: 'Password changed successfully. Please log in again if required.',
    };
  }

  private findByIdentifier(identifier: string) {
    return identifier.includes('@')
      ? this.prisma.user.findUnique({ where: { email: identifier } })
      : this.prisma.user.findUnique({ where: { phone: identifier } });
  }

  async forgotPassword(identifier: string) {
    const genericMessage = {
      message: 'If the account exists, a password reset link has been sent',
    };

    const user = await this.findByIdentifier(identifier);
    // Silent no-op for unknown accounts and for social-only accounts (no
    // password to reset) — same response either way, so an attacker can't
    // use this to enumerate accounts or their sign-in method.
    if (!user || !user.passwordHash) {
      return genericMessage;
    }

    // Prefer a reset link by email — it costs nothing next to an SMS and
    // needs no code re-typing. Fall back to an SMS code only when there's
    // no verified address to send a link to (phone-only accounts, or an
    // email that was never confirmed).
    if (user.email && user.emailVerifiedAt) {
      const token = await this.otp.generateAndStoreToken(user.id, OtpPurpose.PASSWORD_RESET);
      const resetUrl = `${this.config.get<string>('RESET_APP_URL') ?? 'http://localhost:5173'}/reset-password?token=${token}`;
      await this.email.sendPasswordResetLink(user.email, resetUrl);
    } else {
      const code = await this.otp.generateAndStore(user.id, OtpPurpose.PASSWORD_RESET);
      await this.sms.sendOtp(user.phone, code);
    }
    return genericMessage;
  }

  // Mirrors forgotPassword's stance: whatever is wrong with the link/code
  // (unknown account, social-only account, nothing pending, wrong, expired,
  // already used, too many attempts) the caller gets the SAME response, so
  // this route can't be used to probe which accounts exist or have a reset
  // in flight.
  async resetPassword(dto: {
    token?: string;
    identifier?: string;
    code?: string;
    newPassword: string;
  }) {
    if (!dto.token && !(dto.identifier && dto.code)) {
      throw new BadRequestException('Provide either a reset token or an identifier and code');
    }
    const invalid = () =>
      new UnauthorizedException('Invalid or expired reset link or code — request a new one');

    // Hash before looking anything up: the slow step runs for every request,
    // so response time doesn't reveal whether the account exists.
    const passwordHash = await argon2.hash(dto.newPassword);

    // Check the credential WITHOUT burning it yet.
    let found: { id: string; userId: string } | null = null;
    if (dto.token) {
      found = await this.otp.findLiveToken(OtpPurpose.PASSWORD_RESET, dto.token);
    } else {
      const account = await this.findByIdentifier(dto.identifier!);
      const live = account
        ? await this.otp.findLiveCode(account.id, OtpPurpose.PASSWORD_RESET, dto.code!)
        : null;
      found = account && live ? { id: live.id, userId: account.id } : null;
    }
    if (!found) {
      throw invalid();
    }

    // Social-only accounts have no password to reset (forgotPassword never
    // issues them a link) — refuse here too rather than mint one.
    const user = await this.prisma.user.findUnique({
      where: { id: found.userId },
      select: { passwordHash: true },
    });
    if (!user?.passwordHash) {
      throw invalid();
    }

    // Burn the credential, set the password and revoke sessions as ONE unit:
    // claim() is atomic, so a link used twice at once works exactly once,
    // and if saving fails the claim rolls back — the user's link survives
    // for a retry instead of being burned by a transient error.
    const credentialId = found.id;
    const userId = found.userId;
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.otp.claim(tx, credentialId))) {
        throw invalid();
      }
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      // A password reset invalidates every existing session — anyone who
      // still holds a refresh token for this account is locked out...
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // ...and every other reset link/code still in flight, so an older
      // email in the inbox can't be used to change the password again.
      await this.otp.consumeAll(tx, userId, OtpPurpose.PASSWORD_RESET);
    });

    return { message: 'Password has been reset — please log in with your new password' };
  }

  async refresh(refreshToken: string, context?: RequestContext): Promise<TokenPair> {
    const tokenHash = hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.revokedAt) {
      // A revoked token being presented again means it was either reused
      // after rotation or leaked — burn every session for this user.
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token has already been used — all sessions revoked');
    }
    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    // Carry the device/IP forward from the rotated token when the caller
    // didn't supply fresh request context.
    return this.issueTokenPair(user.id, user.role, user.phone, {
      ip: context?.ip ?? stored.ipAddress ?? undefined,
      userAgent: context?.userAgent ?? stored.userAgent ?? undefined,
    });
  }

  async logout(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Logged out' };
  }

  // Public: reused by InvitesService to log a user in immediately after
  // accepting a staff invite, the same way OTP verification does.
  async issueTokenPair(
    userId: string,
    role: UserRole,
    phone: string,
    context?: RequestContext,
  ): Promise<TokenPair> {
    const refreshToken = generateSecureToken();
    const refreshTtlMs = parseDuration(this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '30d');
    const device = context?.userAgent ? describeUserAgent(context.userAgent) : null;

    // Refresh row first — its id becomes the access token's `sid` claim,
    // which is how GET /users/me/sessions marks the current device.
    const stored = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtlMs),
        deviceLabel: device?.deviceLabel ?? null,
        userAgent: context?.userAgent ?? null,
        ipAddress: context?.ip ?? null,
        lastUsedAt: new Date(),
      },
    });

    const accessToken = this.jwt.sign({ sub: userId, role, phone, sid: stored.id });
    return { accessToken, refreshToken };
  }
}
