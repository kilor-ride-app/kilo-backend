import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken } from '../common/utils/token.util';
import { OtpPurpose } from './types/otp-purpose.enum';
import { randomInt } from 'crypto';

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

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
}
