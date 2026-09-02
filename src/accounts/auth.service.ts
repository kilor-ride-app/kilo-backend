import {
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

  async verifyOtp(phone: string, code: string, purpose: OtpPurpose): Promise<TokenPair> {
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

    return this.issueTokenPair(user.id, user.role, user.phone);
  }

  async login(identifier: string, password: string): Promise<TokenPair> {
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

    return this.issueTokenPair(user.id, user.role, user.phone);
  }

  private findByIdentifier(identifier: string) {
    return identifier.includes('@')
      ? this.prisma.user.findUnique({ where: { email: identifier } })
      : this.prisma.user.findUnique({ where: { phone: identifier } });
  }

  async forgotPassword(identifier: string) {
    const genericMessage = {
      message: 'If the account exists, a password reset code has been sent',
    };

    const user = await this.findByIdentifier(identifier);
    // Silent no-op for unknown accounts and for social-only accounts (no
    // password to reset) — same response either way, so an attacker can't
    // use this to enumerate accounts or their sign-in method.
    if (!user || !user.passwordHash) {
      return genericMessage;
    }

    const code = await this.otp.generateAndStore(user.id, OtpPurpose.PASSWORD_RESET);
    // Prefer email — a reset email costs nothing next to an SMS. Fall back
    // to SMS only when there's no verified address to send to (phone-only
    // accounts, or an email that was never confirmed).
    if (user.email && user.emailVerifiedAt) {
      await this.email.sendPasswordResetCode(user.email, code);
    } else {
      await this.sms.sendOtp(user.phone, code);
    }
    return genericMessage;
  }

  async resetPassword(identifier: string, code: string, newPassword: string) {
    const user = await this.findByIdentifier(identifier);
    if (!user) {
      throw new UnauthorizedException('Invalid code');
    }

    await this.otp.verify(user.id, OtpPurpose.PASSWORD_RESET, code);

    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      // A password reset invalidates every existing session — anyone who
      // still holds a refresh token for this account is locked out.
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { message: 'Password has been reset — please log in with your new password' };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
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

    return this.issueTokenPair(user.id, user.role, user.phone);
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
  async issueTokenPair(userId: string, role: UserRole, phone: string): Promise<TokenPair> {
    const accessToken = this.jwt.sign({ sub: userId, role, phone });

    const refreshToken = generateSecureToken();
    const refreshTtlMs = parseDuration(this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '30d');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtlMs),
      },
    });

    return { accessToken, refreshToken };
  }
}
