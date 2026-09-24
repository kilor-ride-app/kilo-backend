import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountType,
  Prisma,
  TopUpMethod,
  TopUpPurpose,
  TopUpRequest,
  TopUpStatus,
  TransactionStatus,
  User,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaystackService,
  VerifyTransactionResult,
} from '../integrations/paystack/paystack.service';
import { NotificationCategory } from '../notifications/notification-categories';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { generateSecureToken } from '../common/utils/token.util';
import { WalletService } from './wallet.service';

// Paystack's temporary transfer account stays open this long.
const BANK_TRANSFER_WINDOW_MS = 30 * 60 * 1000;
// Small charge that proves and saves a card; credited to the wallet, so
// adding a card never costs the user anything.
const CARD_SETUP_AMOUNT_CONFIG_KEY = 'cardSetupAmount';
const DEFAULT_CARD_SETUP_AMOUNT = 50;
// Only these mean the payment is definitively not happening. "abandoned"
// is also what Paystack reports for a checkout the user simply hasn't
// finished yet, so it stays PENDING.
const TERMINAL_FAILURE_STATUSES = ['failed', 'reversed'];

function toKobo(nairaAmount: Prisma.Decimal | number): number {
  return Math.round(new Prisma.Decimal(nairaAmount).mul(100).toNumber());
}

function fromKobo(kobo: number): Prisma.Decimal {
  return new Prisma.Decimal(kobo).div(100);
}

// Everything about a saved card except the reusable authorization code.
const CARD_PUBLIC_SELECT = {
  id: true,
  last4: true,
  brand: true,
  expMonth: true,
  expYear: true,
  bank: true,
  isDefault: true,
  createdAt: true,
} satisfies Prisma.PaymentCardSelect;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly paystack: PaystackService,
    private readonly platformConfig: PlatformConfigService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  // CARD returns a Paystack checkout (authorizationUrl for web, accessCode
  // for the mobile SDK) — card details are entered there, never sent to
  // us. SAVED_CARD charges a stored card directly. BANK_TRANSFER returns a
  // one-off account number to pay into. Every path finishes the same way:
  // charge.success webhook (or a status poll) credits the wallet.
  async initiateTopUp(
    userId: string,
    params: { amount: number; method?: TopUpMethod; cardId?: string; saveCard?: boolean },
  ) {
    const method = params.method ?? TopUpMethod.CARD;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const amount = new Prisma.Decimal(params.amount);
    const reference = `topup:${generateSecureToken(12)}`;
    const metadata = { userId, purpose: TopUpPurpose.TOPUP };

    if (method === TopUpMethod.SAVED_CARD) {
      return this.chargeSavedCard(user, amount, reference, params.cardId);
    }

    if (method === TopUpMethod.BANK_TRANSFER) {
      const charge = await this.paystack.chargeBankTransfer({
        email: this.paystackEmail(user),
        amountKobo: toKobo(amount),
        reference,
        expiresAt: new Date(Date.now() + BANK_TRANSFER_WINDOW_MS),
        metadata,
      });
      const request = await this.prisma.topUpRequest.create({
        data: {
          reference,
          userId,
          amount,
          method,
          bankName: charge.bank.name,
          accountNumber: charge.account_number,
          accountName: charge.account_name,
          accountExpiresAt: new Date(charge.account_expires_at),
        },
      });
      return this.toTopUpView(request);
    }

    // Row first, so a fast webhook always finds it.
    const request = await this.prisma.topUpRequest.create({
      data: { reference, userId, amount, method, saveCard: params.saveCard ?? false },
    });
    const checkout = await this.paystack.initializeTransaction({
      email: this.paystackEmail(user),
      amountKobo: toKobo(amount),
      reference,
      metadata,
      channels: ['card'],
    });
    return {
      ...this.toTopUpView(request),
      authorizationUrl: checkout.authorization_url,
      accessCode: checkout.access_code,
    };
  }

  // "Add a card": a small charge through Paystack checkout that, once it
  // succeeds, saves the card and credits the same amount to the wallet.
  async initiateCardSetup(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const amount = new Prisma.Decimal(
      await this.platformConfig.get<number>(
        CARD_SETUP_AMOUNT_CONFIG_KEY,
        DEFAULT_CARD_SETUP_AMOUNT,
      ),
    );
    const reference = `topup:${generateSecureToken(12)}`;
    const request = await this.prisma.topUpRequest.create({
      data: {
        reference,
        userId,
        amount,
        method: TopUpMethod.CARD,
        purpose: TopUpPurpose.CARD_SETUP,
        saveCard: true,
      },
    });
    const checkout = await this.paystack.initializeTransaction({
      email: this.paystackEmail(user),
      amountKobo: toKobo(amount),
      reference,
      metadata: { userId, purpose: TopUpPurpose.CARD_SETUP },
      channels: ['card'],
    });
    return {
      ...this.toTopUpView(request),
      authorizationUrl: checkout.authorization_url,
      accessCode: checkout.access_code,
    };
  }

  // Polled by the "Processing payment" screen. A still-PENDING request is
  // re-checked with Paystack, so the wallet is credited even if the
  // webhook is slow or was missed.
  async getTopUpStatus(userId: string, reference: string) {
    let request = await this.prisma.topUpRequest.findUnique({ where: { reference } });
    if (!request || request.userId !== userId) {
      throw new NotFoundException('Top-up not found');
    }
    if (request.status === TopUpStatus.PENDING) {
      try {
        await this.applyVerifiedTopUp(await this.paystack.verifyTransaction(reference));
      } catch (err) {
        this.logger.warn(`Could not refresh top-up ${reference} from Paystack: ${err}`);
      }
      request = await this.prisma.topUpRequest.findUniqueOrThrow({ where: { reference } });
    }
    return this.toTopUpView(request);
  }

  listCards(userId: string) {
    return this.prisma.paymentCard.findMany({
      where: { userId },
      select: CARD_PUBLIC_SELECT,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async setDefaultCard(userId: string, cardId: string) {
    await this.findOwnedCard(userId, cardId);
    await this.prisma.$transaction([
      this.prisma.paymentCard.updateMany({ where: { userId }, data: { isDefault: false } }),
      this.prisma.paymentCard.update({ where: { id: cardId }, data: { isDefault: true } }),
    ]);
    return this.listCards(userId);
  }

  async removeCard(userId: string, cardId: string) {
    const card = await this.findOwnedCard(userId, cardId);
    await this.prisma.paymentCard.delete({ where: { id: cardId } });
    if (card.isDefault) {
      // Promote the most recent remaining card, if any.
      const next = await this.prisma.paymentCard.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      if (next) {
        await this.prisma.paymentCard.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    }
    return { deleted: true };
  }

  // Independently re-verifies against Paystack rather than trusting the
  // webhook payload's own status field (plan.md Section 10) — the payload
  // just tells us *which* transaction to go check.
  async processTopUpWebhookEvent(reference: string) {
    await this.applyVerifiedTopUp(await this.paystack.verifyTransaction(reference));
  }

  // Idempotent end to end: every ledger write is keyed by reference, so
  // the webhook and a status poll can both land here for one payment.
  private async applyVerifiedTopUp(verified: VerifyTransactionResult) {
    const reference = verified.reference;
    if (verified.status !== 'success') {
      if (TERMINAL_FAILURE_STATUSES.includes(verified.status)) {
        await this.prisma.topUpRequest.updateMany({
          where: { reference, status: TopUpStatus.PENDING },
          data: {
            status: TopUpStatus.FAILED,
            failureReason: verified.gateway_response ?? verified.status,
          },
        });
      }
      this.logger.warn(
        `Top-up ${reference} verified as non-success (${verified.status}) — not crediting`,
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

    // Already credited under any of the references a first pass can write?
    // Needed because the driver branch below picks its references from the
    // *current* commission balance: once a first pass has settled the debt
    // the balance is zero, and a second pass (re-delivered webhook, or the
    // webhook racing a status poll) would otherwise credit the full amount
    // again under the plain reference.
    const alreadyCredited = await this.prisma.transaction.findFirst({
      where: { reference: { in: [reference, `${reference}:settle`, `${reference}:credit`] } },
      select: { id: true },
    });
    if (alreadyCredited) {
      await this.completeTopUpRequest(reference, userId, verified);
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
        await this.completeTopUpRequest(reference, userId, verified);
        return;
      }
    }

    await this.wallet.topUp(userId, amount, reference);
    await this.completeTopUpRequest(reference, userId, verified);
  }

  private async completeTopUpRequest(
    reference: string,
    userId: string,
    verified: VerifyTransactionResult,
  ) {
    const request = await this.prisma.topUpRequest.findUnique({ where: { reference } });
    if (!request || request.status === TopUpStatus.COMPLETED) {
      return; // pre-TopUpRequest top-up, or already finalised by the other path
    }

    const auth = verified.authorization;
    const brand = auth ? (auth.brand ?? auth.card_type).trim().toLowerCase() : undefined;
    let cardId = request.cardId;
    if (request.saveCard && auth?.channel === 'card' && auth.reusable && auth.signature) {
      const cardData = {
        authorizationCode: auth.authorization_code,
        last4: auth.last4,
        brand: brand!,
        expMonth: auth.exp_month,
        expYear: auth.exp_year,
        bank: auth.bank,
      };
      const isFirstCard = (await this.prisma.paymentCard.count({ where: { userId } })) === 0;
      const card = await this.prisma.paymentCard.upsert({
        where: { userId_signature: { userId, signature: auth.signature } },
        update: cardData,
        create: { userId, signature: auth.signature, isDefault: isFirstCard, ...cardData },
      });
      cardId = card.id;
    }

    const completed = await this.prisma.topUpRequest.updateMany({
      where: { reference, status: { not: TopUpStatus.COMPLETED } },
      data: {
        status: TopUpStatus.COMPLETED,
        completedAt: new Date(),
        cardId,
        cardLast4: auth?.last4 ?? request.cardLast4,
        cardBrand: brand ?? request.cardBrand,
      },
    });
    // count guards against the webhook and a status poll both notifying.
    if (completed.count > 0) {
      const amount = `₦${request.amount.toNumber().toLocaleString('en-NG')}`;
      this.notifications.notify(
        userId,
        NotificationCategory.ACCOUNT,
        request.purpose === TopUpPurpose.CARD_SETUP ? 'Card added' : 'Top-up successful',
        request.purpose === TopUpPurpose.CARD_SETUP
          ? `Your card was saved and ${amount} was added to your wallet.`
          : `${amount} was added to your wallet.`,
        { reference },
      );
    }
  }

  private async chargeSavedCard(
    user: User,
    amount: Prisma.Decimal,
    reference: string,
    cardId?: string,
  ) {
    if (!cardId) {
      throw new BadRequestException('cardId is required for SAVED_CARD top-ups');
    }
    const card = await this.findOwnedCard(user.id, cardId);
    await this.prisma.topUpRequest.create({
      data: {
        reference,
        userId: user.id,
        amount,
        method: TopUpMethod.SAVED_CARD,
        cardId: card.id,
        cardLast4: card.last4,
        cardBrand: card.brand,
      },
    });

    try {
      const charge = await this.paystack.chargeAuthorization({
        email: this.paystackEmail(user),
        amountKobo: toKobo(amount),
        authorizationCode: card.authorizationCode,
        reference,
        metadata: { userId: user.id, purpose: TopUpPurpose.TOPUP },
      });
      if (charge.status === 'success') {
        // Credit now so the app can show success immediately; the webhook
        // that follows is a no-op.
        await this.applyVerifiedTopUp(await this.paystack.verifyTransaction(reference));
      } else if (TERMINAL_FAILURE_STATUSES.includes(charge.status)) {
        await this.markTopUpFailed(reference, charge.gateway_response ?? charge.status);
      }
    } catch (err) {
      await this.markTopUpFailed(reference, 'The card could not be charged');
      throw err;
    }
    return this.toTopUpView(
      await this.prisma.topUpRequest.findUniqueOrThrow({ where: { reference } }),
    );
  }

  private async markTopUpFailed(reference: string, reason: string) {
    await this.prisma.topUpRequest.updateMany({
      where: { reference, status: TopUpStatus.PENDING },
      data: { status: TopUpStatus.FAILED, failureReason: reason },
    });
  }

  private async findOwnedCard(userId: string, cardId: string) {
    const card = await this.prisma.paymentCard.findUnique({ where: { id: cardId } });
    if (!card || card.userId !== userId) {
      throw new NotFoundException('Card not found');
    }
    return card;
  }

  // Paystack requires an email on every charge, but a Kilo account may not
  // have one (email is optional at sign-up). Fall back to a stable
  // per-user address on our own domain so phone-only users can still pay.
  private paystackEmail(user: User): string {
    if (user.email) {
      return user.email;
    }
    const domain = this.config.get<string>('PAYSTACK_FALLBACK_EMAIL_DOMAIN') ?? 'customers.kilo.ng';
    return `${user.publicId.toLowerCase()}@${domain}`;
  }

  private toTopUpView(request: TopUpRequest) {
    return {
      reference: request.reference,
      status: request.status,
      method: request.method,
      purpose: request.purpose,
      amount: request.amount,
      card: request.cardLast4 ? { last4: request.cardLast4, brand: request.cardBrand } : null,
      bankTransfer:
        request.method === TopUpMethod.BANK_TRANSFER
          ? {
              bankName: request.bankName,
              accountNumber: request.accountNumber,
              accountName: request.accountName,
              expiresAt: request.accountExpiresAt,
            }
          : null,
      failureReason: request.failureReason,
      createdAt: request.createdAt,
      completedAt: request.completedAt,
    };
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
