import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountType, Prisma, ReferralRedemptionStatus, UserRole } from '@prisma/client';
import { randomInt } from 'crypto';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — avoids ambiguous characters when read aloud
const CODE_LENGTH = 8;
const REFERRAL_BONUS_CONFIG_KEY = 'referralBonusAmount';
const DEFAULT_REFERRAL_BONUS = 500;

@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly platformConfig: PlatformConfigService,
  ) {}

  async generateCode(userId: string) {
    const existing = await this.prisma.referralCode.findUnique({ where: { userId } });
    if (existing) {
      return existing;
    }
    // Collision retry — astronomically unlikely at 33^8 combinations, but
    // the unique constraint means a collision would otherwise 500.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.referralCode.create({
          data: { userId, code: this.generateRandomCode() },
        });
      } catch (err) {
        if (attempt === 4) throw err;
      }
    }
    throw new Error('Failed to generate a unique referral code');
  }

  async myStats(userId: string) {
    const referralCode = await this.prisma.referralCode.findUnique({
      where: { userId },
      include: { redemptions: true },
    });
    if (!referralCode) {
      return { code: null, invites: 0, conversions: 0, totalEarnings: 0 };
    }
    const conversions = referralCode.redemptions.filter(
      (r) => r.status !== ReferralRedemptionStatus.PENDING,
    ).length;
    const totalEarnings = referralCode.redemptions.reduce(
      (sum, r) => sum.plus(r.earningsAmount),
      new Prisma.Decimal(0),
    );
    return {
      code: referralCode.code,
      invites: referralCode.redemptions.length,
      conversions,
      totalEarnings,
    };
  }

  // Applied post-registration (the referred user calls this themselves,
  // once, after signing up) — not wired into the registration endpoints
  // themselves, to avoid touching AccountsModule's already-tested flow.
  // Qualifies immediately on redemption in this pass — see the schema
  // comment on ReferralRedemptionStatus for why "must complete a first
  // ride" isn't gated here.
  async redeem(referredUserId: string, code: string) {
    const referralCode = await this.prisma.referralCode.findUnique({
      where: { code: code.toUpperCase() },
    });
    if (!referralCode) {
      throw new NotFoundException('Referral code not found');
    }
    if (referralCode.userId === referredUserId) {
      throw new BadRequestException('You cannot redeem your own referral code');
    }
    const existing = await this.prisma.referralRedemption.findUnique({
      where: { referredUserId },
    });
    if (existing) {
      throw new ConflictException('You have already redeemed a referral code');
    }

    const bonusAmount = await this.platformConfig.get(
      REFERRAL_BONUS_CONFIG_KEY,
      DEFAULT_REFERRAL_BONUS,
    );

    const redemption = await this.prisma.referralRedemption.create({
      data: {
        referralCodeId: referralCode.id,
        referrerId: referralCode.userId,
        referredUserId,
        earningsAmount: bonusAmount,
        status: ReferralRedemptionStatus.QUALIFIED,
      },
    });

    await this.wallet.recordReferralAccrual(
      redemption.earningsAmount,
      `referral-accrual:${redemption.id}`,
    );

    return redemption;
  }

  async listAll(status?: ReferralRedemptionStatus, take = 50, skip = 0) {
    return this.prisma.referralRedemption.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  // Pays out every QUALIFIED-but-unpaid redemption in one pass.
  async processPayouts() {
    const qualified = await this.prisma.referralRedemption.findMany({
      where: { status: ReferralRedemptionStatus.QUALIFIED },
      include: { referrer: { select: { role: true } } },
    });

    const results = [];
    for (const redemption of qualified) {
      const accountType =
        redemption.referrer.role === UserRole.DRIVER
          ? AccountType.DRIVER_WALLET
          : AccountType.RIDER_WALLET;
      const tx = await this.wallet.payReferralPayout(
        redemption.referrerId,
        accountType,
        redemption.earningsAmount,
        `referral-payout:${redemption.id}`,
      );
      const updated = await this.prisma.referralRedemption.update({
        where: { id: redemption.id },
        data: { status: ReferralRedemptionStatus.PAID, paidAt: new Date(), transactionId: tx.id },
      });
      results.push(updated);
    }
    return { paidCount: results.length, redemptions: results };
  }

  private generateRandomCode(): string {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_CHARS[randomInt(0, CODE_CHARS.length)];
    }
    return code;
  }
}
