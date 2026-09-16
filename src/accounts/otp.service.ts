import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { generateSecureToken, hashToken } from '../common/utils/token.util';
import { OtpPurpose } from './types/otp-purpose.enum';
import { randomInt } from 'crypto';

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
// Longer than the numeric-code TTL — a link sits in an inbox and gets
// clicked later, where a code is read off the same screen it's typed into.
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

// Generic "generate a code tied to a user+purpose, verify it later" core,
// shared by phone OTP (AuthService) and email verification
// (EmailVerificationService) — deliberately channel-agnostic; callers own
// sending the code (SMS vs email) and whatever happens on success.
@Injectable()
export class OtpService {
  constructor(private readonly prisma: PrismaService) {}

  async generateAndStore(userId: string, purpose: OtpPurpose): Promise<string> {
    const code = randomInt(0, 10 ** OTP_LENGTH)
      .toString()
      .padStart(OTP_LENGTH, '0');
    await this.prisma.otpCode.create({
      data: {
        userId,
        codeHash: hashToken(code),
        purpose,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    return code;
  }

  async verify(userId: string, purpose: OtpPurpose, code: string): Promise<void> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) {
      throw new UnauthorizedException('Invalid or expired code');
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new ForbiddenException('Too many attempts — request a new code');
    }
    if (otp.expiresAt < new Date()) {
      throw new UnauthorizedException('Code has expired');
    }
    if (otp.codeHash !== hashToken(code)) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Invalid code');
    }

    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
  }

  // Link-based counterpart to generateAndStore/verify above — a
  // high-entropy token instead of a guessable 6-digit code, so it's looked
  // up by its own hash rather than by userId+purpose (the caller doesn't
  // know the userId until the token resolves it).
  async generateAndStoreToken(userId: string, purpose: OtpPurpose): Promise<string> {
    const token = generateSecureToken();
    await this.prisma.otpCode.create({
      data: {
        userId,
        codeHash: hashToken(token),
        purpose,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });
    return token;
  }

  async verifyToken(purpose: OtpPurpose, token: string): Promise<string> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { purpose, codeHash: hashToken(token), consumedAt: null },
    });
    if (!otp || otp.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired link — request a new one');
    }

    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });
    return otp.userId;
  }
}
