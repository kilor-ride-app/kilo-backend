import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateSecureToken, hashToken } from '../common/utils/token.util';
import { OtpPurpose } from './types/otp-purpose.enum';
import { randomInt } from 'crypto';

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
// Longer than the numeric-code TTL — a link sits in an inbox and gets
// clicked later, where a code is read off the same screen it's typed into.
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

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
  // up by its own hash rather than by userId+purpose (the caller presents
  // only the token, which resolves the user).
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

  // ── Two-step consumption, for flows that must act before burning ────
  //
  // The password-reset flow can't consume on read: it has to (1) check the
  // token, (2) save the new password, and only then burn the token — all or
  // nothing, and safe when the same link arrives twice at once. So it's
  // split: findLiveToken checks without consuming, claim() burns it
  // atomically inside the caller's transaction, consumeAll() kills whatever
  // else is outstanding. Every failure is a plain null — the caller decides
  // how (uniformly) to report it, so nothing here leaks *why* a token was
  // rejected.

  /** A live (unconsumed, unexpired) token's row, or null. Does not consume. */
  async findLiveToken(
    purpose: OtpPurpose,
    token: string,
  ): Promise<{ id: string; userId: string } | null> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { purpose, codeHash: hashToken(token), consumedAt: null },
    });
    if (!otp || otp.expiresAt < new Date()) {
      return null;
    }
    return { id: otp.id, userId: otp.userId };
  }

  /**
   * Burns one token. The `consumedAt: null` guard lives in the UPDATE
   * itself, so when two requests race on the same link exactly one gets
   * `true` — the other's UPDATE matches no row.
   */
  async claim(db: Prisma.TransactionClient, id: string): Promise<boolean> {
    const { count } = await db.otpCode.updateMany({
      where: { id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    return count === 1;
  }

  /** Kills every still-outstanding token of this purpose for the user. */
  async consumeAll(
    db: Prisma.TransactionClient,
    userId: string,
    purpose: OtpPurpose,
  ): Promise<void> {
    await db.otpCode.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }
}
