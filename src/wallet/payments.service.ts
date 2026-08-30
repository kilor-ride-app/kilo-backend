import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AccountType, Prisma, TransactionStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackService } from '../integrations/paystack/paystack.service';
import { generateSecureToken } from '../common/utils/token.util';
import { WalletService } from './wallet.service';

function toKobo(nairaAmount: Prisma.Decimal | number): number {
  return Math.round(new Prisma.Decimal(nairaAmount).mul(100).toNumber());
}

function fromKobo(kobo: number): Prisma.Decimal {
  return new Prisma.Decimal(kobo).div(100);
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly paystack: PaystackService,
  ) {}

  async initiateTopUp(userId: string, amount: number) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.email) {
      throw new BadRequestException(
        'An email address is required to top up — add one via POST /users/me/email first',
      );
    }
    const reference = `topup:${generateSecureToken(12)}`;
    const result = await this.paystack.initializeTransaction({
      email: user.email,
      amountKobo: toKobo(amount),
      reference,
      metadata: { userId },
    });
    return { reference: result.reference, authorizationUrl: result.authorization_url };
  }

  // Independently re-verifies against Paystack rather than trusting the
  // webhook payload's own status field (plan.md Section 10) — the payload
  // just tells us *which* transaction to go check.
  async processTopUpWebhookEvent(reference: string) {
    const verified = await this.paystack.verifyTransaction(reference);
    if (verified.status !== 'success') {
      this.logger.warn(
        `Top-up webhook for ${reference} verified as non-success (${verified.status}) — ignoring`,
      );
      return;
    }

    const userId = verified.metadata?.userId as string | undefined;
    if (!userId) {
      this.logger.error(
        `Top-up webhook for ${reference} has no userId in metadata — cannot process`,
      );
      return;
    }

    const amount = fromKobo(verified.amount);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      this.logger.error(`Top-up webhook for ${reference} references unknown user ${userId}`);
      return;
    }

    // Drivers auto-deduct against outstanding commission before anything
    // reaches their spendable wallet (TransactionType.COMMISSION_SETTLEMENT:
    // "top-up auto-deduction against outstanding commission"). Both writes
    // use deterministic sub-references so a re-delivered webhook is a safe
    // no-op regardless of what the payable balance has changed to since.
    if (user.role === UserRole.DRIVER) {
      const payable = await this.wallet.getOrCreateUserAccount(
        userId,
        AccountType.DRIVER_COMMISSION_PAYABLE,
      );
      if (payable.balance.greaterThan(0)) {
        const settleAmount = Prisma.Decimal.min(payable.balance, amount);
        await this.wallet.settleCommission(userId, settleAmount, `${reference}:settle`, {
          topupReference: reference,
        });
        const remaining = amount.minus(settleAmount);
        if (remaining.greaterThan(0)) {
          await this.wallet.topUp(userId, remaining, `${reference}:credit`, undefined, {
            topupReference: reference,
          });
        }
        return;
      }
    }

    await this.wallet.topUp(userId, amount, reference);
  }

  // Outstanding cash-ride commission is auto-deducted from the withdrawal
  // before anything reaches the bank — the driver's wallet still loses the
  // *full* requested amount (that's what "withdraw X" means to them), the
  // settled portion just never leaves via the gateway. This mirrors the
  // topup-auto-deduct flow above: in both cases, PLATFORM_GATEWAY_CLEARING
  // only ever reflects money that actually crosses the gateway boundary,
  // never the portion absorbed by an internal commission settlement.
  async initiateWithdrawal(
    driverId: string,
    amount: number,
    accountNumber: string,
    bankCode: string,
  ) {
    const requestedAmount = new Prisma.Decimal(amount);
    const payable = await this.wallet.getOrCreateUserAccount(
      driverId,
      AccountType.DRIVER_COMMISSION_PAYABLE,
    );
    const settleAmount = Prisma.Decimal.min(payable.balance, requestedAmount);
    const transferAmount = requestedAmount.minus(settleAmount);
    const reference = `withdraw:${generateSecureToken(12)}`;

    // Only resolve/register a bank recipient with Paystack if money is
    // actually going to move — a withdrawal fully absorbed by outstanding
    // commission has nothing to verify a payout destination for.
    const recipientCode = transferAmount.greaterThan(0)
      ? await (async () => {
          const resolved = await this.paystack.resolveAccountNumber(accountNumber, bankCode);
          const recipient = await this.paystack.createTransferRecipient({
            name: resolved.account_name,
            accountNumber,
            bankCode,
          });
          return recipient.recipient_code;
        })()
      : `unverified:${bankCode}:${accountNumber}`;

    // Debits the wallet for the full requested amount now — funds are
    // reserved the moment we commit to this withdrawal, before the external
    // transfer call even happens.
    const ledgerTx = await this.wallet.requestWithdrawal(driverId, requestedAmount, reference, {
      recipientCode,
      settledCommission: settleAmount.toString(),
    });

    let settleTx: { id: string } | undefined;
    if (settleAmount.greaterThan(0)) {
      settleTx = await this.wallet.settleCommission(driverId, settleAmount, `${reference}:settle`, {
        withdrawalReference: reference,
      });
    }

    const withdrawalRequest = await this.prisma.withdrawalRequest.create({
      data: {
        driverId,
        amount,
        settledCommission: settleAmount,
        status: transferAmount.greaterThan(0)
          ? TransactionStatus.PENDING
          : TransactionStatus.COMPLETED,
        transactionId: ledgerTx.id,
        bankAccountId: recipientCode,
        ...(transferAmount.isZero() ? { completedAt: new Date() } : {}),
      },
    });

    if (transferAmount.isZero()) {
      // Entire requested amount was absorbed by outstanding commission —
      // nothing left to actually send to the bank.
      return withdrawalRequest;
    }

    try {
      const transfer = await this.paystack.initiateTransfer({
        amountKobo: toKobo(transferAmount),
        recipientCode,
        reference,
        reason: 'Kilo driver withdrawal',
      });
      return this.prisma.withdrawalRequest.update({
        where: { id: withdrawalRequest.id },
        data: { gatewayReference: transfer.transfer_code },
      });
    } catch (err) {
      // The gateway call failed outright (not a later async failure via
      // webhook) — reverse the whole attempt, including any commission
      // settlement, rather than leaving the driver's funds stuck in limbo
      // or the debt wrongly marked as paid.
      await this.wallet.refund(ledgerTx.id, 'Withdrawal initiation failed at the gateway');
      if (settleTx) {
        await this.wallet.refund(
          settleTx.id,
          'Withdrawal initiation failed at the gateway — commission settlement reversed',
        );
      }
      await this.prisma.withdrawalRequest.update({
        where: { id: withdrawalRequest.id },
        data: { status: TransactionStatus.FAILED },
      });
      throw err;
    }
  }

  async processTransferWebhookEvent(reference: string, succeeded: boolean) {
    const transaction = await this.prisma.transaction.findUnique({ where: { reference } });
    if (!transaction) {
      this.logger.warn(`Transfer webhook for unknown reference ${reference} — ignoring`);
      return;
    }
    const withdrawalRequest = await this.prisma.withdrawalRequest.findUnique({
      where: { transactionId: transaction.id },
    });
    if (!withdrawalRequest) {
      throw new NotFoundException(`No withdrawal request linked to transaction ${transaction.id}`);
    }

    if (succeeded) {
      await this.prisma.withdrawalRequest.update({
        where: { id: withdrawalRequest.id },
        data: { status: TransactionStatus.COMPLETED, completedAt: new Date() },
      });
    } else {
      await this.wallet.refund(transaction.id, 'Paystack transfer failed after initiation');
      const settleTx = await this.prisma.transaction.findUnique({
        where: { reference: `${reference}:settle` },
      });
      if (settleTx) {
        await this.wallet.refund(
          settleTx.id,
          'Paystack transfer failed after initiation — commission settlement reversed',
        );
      }
      await this.prisma.withdrawalRequest.update({
        where: { id: withdrawalRequest.id },
        data: { status: TransactionStatus.FAILED },
      });
    }
  }
}
