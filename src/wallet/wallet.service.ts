import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountType,
  LedgerDirection,
  Prisma,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Decimal = Prisma.Decimal;
type PrismaTx = Prisma.TransactionClient;

interface LedgerEntryInput {
  accountId: string;
  direction: LedgerDirection;
  amount: Decimal;
}

interface PostTransactionParams {
  type: TransactionType;
  reference: string;
  idempotencyKey?: string;
  amount: Decimal;
  currency?: string;
  metadata?: Prisma.InputJsonValue;
  entries: LedgerEntryInput[];
  reversesTransactionId?: string;
}

// The one place every wallet-affecting operation in this module funnels
// through. Double-entry (debits === credits, checked below), append-only,
// idempotent-by-reference (a duplicate reference — e.g. the same webhook
// delivered twice — is a safe no-op, not a re-process), and balance changes
// use the atomic conditional UPDATE pattern from plan.md Section 13
// (`WHERE balance >= amount` for debits) rather than a separate row lock —
// a single UPDATE statement is already atomic per row in Postgres.
@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateUserAccount(ownerId: string, type: AccountType) {
    return this.prisma.account.upsert({
      where: { ownerId_type: { ownerId, type } },
      update: {},
      create: { ownerId, type },
    });
  }

  async getPlatformAccount(type: AccountType) {
    const account = await this.prisma.account.findFirst({ where: { ownerId: null, type } });
    if (!account) {
      // Deliberately not lazily created here — see scripts/seed-platform-accounts.js.
      throw new NotFoundException(
        `Platform account ${type} has not been seeded — run npm run seed:platform-accounts`,
      );
    }
    return account;
  }

  async topUp(
    userId: string,
    amount: Decimal,
    reference: string,
    idempotencyKey?: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    const [riderAccount, clearing] = await Promise.all([
      this.getOrCreateUserAccount(userId, AccountType.RIDER_WALLET),
      this.getPlatformAccount(AccountType.PLATFORM_GATEWAY_CLEARING),
    ]);

    return this.postTransaction({
      type: TransactionType.WALLET_TOPUP,
      reference,
      idempotencyKey,
      amount,
      metadata,
      entries: [
        { accountId: clearing.id, direction: LedgerDirection.DEBIT, amount },
        { accountId: riderAccount.id, direction: LedgerDirection.CREDIT, amount },
      ],
    });
  }

  // `taxAmount` is part of fareAmount but belongs to neither the driver
  // nor the platform — it's routed to PLATFORM_TAX_PAYABLE.
  async payForRide(
    riderId: string,
    driverId: string,
    fareAmount: Decimal,
    commissionAmount: Decimal,
    reference: string,
    metadata?: Prisma.InputJsonValue,
    taxAmount: Decimal = new Prisma.Decimal(0),
  ) {
    const driverAmount = fareAmount.minus(commissionAmount).minus(taxAmount);
    const [riderAccount, driverAccount, platformRevenue] = await Promise.all([
      this.getOrCreateUserAccount(riderId, AccountType.RIDER_WALLET),
      this.getOrCreateUserAccount(driverId, AccountType.DRIVER_WALLET),
      this.getPlatformAccount(AccountType.PLATFORM_REVENUE),
    ]);

    return this.postTransaction({
      type: TransactionType.RIDE_PAYMENT_WALLET,
      reference,
      amount: fareAmount,
      metadata,
      entries: [
        { accountId: riderAccount.id, direction: LedgerDirection.DEBIT, amount: fareAmount },
        { accountId: driverAccount.id, direction: LedgerDirection.CREDIT, amount: driverAmount },
        {
          accountId: platformRevenue.id,
          direction: LedgerDirection.CREDIT,
          amount: commissionAmount,
        },
        ...(await this.taxEntries(taxAmount)),
      ],
    });
  }

  // Delivery counterpart of payForRide — same shape, same accounts
  // (senderId's spendable wallet reuses RIDER_WALLET; there's no distinct
  // "customer wallet" account type, and a delivery sender is functionally
  // in the same role a rider is).
  async payForDelivery(
    senderId: string,
    driverId: string,
    fareAmount: Decimal,
    commissionAmount: Decimal,
    reference: string,
    metadata?: Prisma.InputJsonValue,
    taxAmount: Decimal = new Prisma.Decimal(0),
  ) {
    const driverAmount = fareAmount.minus(commissionAmount).minus(taxAmount);
    const [senderAccount, driverAccount, platformRevenue] = await Promise.all([
      this.getOrCreateUserAccount(senderId, AccountType.RIDER_WALLET),
      this.getOrCreateUserAccount(driverId, AccountType.DRIVER_WALLET),
      this.getPlatformAccount(AccountType.PLATFORM_REVENUE),
    ]);

    return this.postTransaction({
      type: TransactionType.DELIVERY_PAYMENT_WALLET,
      reference,
      amount: fareAmount,
      metadata,
      entries: [
        { accountId: senderAccount.id, direction: LedgerDirection.DEBIT, amount: fareAmount },
        { accountId: driverAccount.id, direction: LedgerDirection.CREDIT, amount: driverAmount },
        {
          accountId: platformRevenue.id,
          direction: LedgerDirection.CREDIT,
          amount: commissionAmount,
        },
        ...(await this.taxEntries(taxAmount)),
      ],
    });
  }

  // Delivery counterpart of recordCashRideCommission — same DEBT accrual
  // shape, and deliberately increments the SAME unsettledCashRideCount
  // counter/cap as cash rides do (see DriverStatus schema comment): the
  // debt is against the same DRIVER_COMMISSION_PAYABLE account regardless
  // of which line of work created it, so the cap has to be shared too.
  async recordCashDeliveryCommission(
    driverId: string,
    amount: Decimal,
    reference: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    const [clearing, payable] = await Promise.all([
      this.getPlatformAccount(AccountType.PLATFORM_GATEWAY_CLEARING),
      this.getOrCreateUserAccount(driverId, AccountType.DRIVER_COMMISSION_PAYABLE),
    ]);

    const alreadyProcessed = await this.prisma.transaction.findUnique({ where: { reference } });

    const tx = await this.postTransaction({
      type: TransactionType.DELIVERY_PAYMENT_CASH,
      reference,
      amount,
      metadata,
      entries: [
        { accountId: clearing.id, direction: LedgerDirection.DEBIT, amount },
        { accountId: payable.id, direction: LedgerDirection.CREDIT, amount },
      ],
    });

    if (!alreadyProcessed) {
      await this.prisma.driverStatus.updateMany({
        where: { userId: driverId },
        data: { unsettledCashRideCount: { increment: 1 } },
      });
    }

    return tx;
  }

  // Pays down an outstanding DRIVER_COMMISSION_PAYABLE balance (e.g. an
  // auto-deduction against a top-up or a withdrawal) — sibling to
  // recordCashRideCommission below, which is how that balance grows in the
  // first place. Resets the cash-ride cap counter, but only on a full
  // clear — a partial payment doesn't lift the cap.
  async settleCommission(
    driverId: string,
    amount: Decimal,
    reference: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    const [payable, platformRevenue] = await Promise.all([
      this.getOrCreateUserAccount(driverId, AccountType.DRIVER_COMMISSION_PAYABLE),
      this.getPlatformAccount(AccountType.PLATFORM_REVENUE),
    ]);

    const alreadyProcessed = await this.prisma.transaction.findUnique({ where: { reference } });

    const tx = await this.postTransaction({
      type: TransactionType.COMMISSION_SETTLEMENT,
      reference,
      amount,
      metadata,
      entries: [
        { accountId: payable.id, direction: LedgerDirection.DEBIT, amount },
        { accountId: platformRevenue.id, direction: LedgerDirection.CREDIT, amount },
      ],
    });

    if (!alreadyProcessed) {
      const updated = await this.prisma.account.findUniqueOrThrow({ where: { id: payable.id } });
      if (updated.balance.isZero()) {
        await this.prisma.driverStatus.updateMany({
          where: { userId: driverId },
          data: { unsettledCashRideCount: 0 },
        });
      }
    }

    return tx;
  }

  // Called when a CASH ride/delivery completes — the driver kept the cash,
  // so the platform's cut is now owed rather than collected. Uses
  // PLATFORM_GATEWAY_CLEARING (not PLATFORM_REVENUE) as the counterparty
  // deliberately: revenue is only recognized once real money actually moves
  // through settleCommission, not at the moment the debt merely accrues —
  // avoids a debt that's still outstanding ever showing up as recognized
  // revenue. Also increments the driver's unsettled-cash-ride counter —
  // DispatchService refuses to offer them further cash rides once it hits
  // the cap, until settleCommission resets it.
  async recordCashRideCommission(
    driverId: string,
    amount: Decimal,
    reference: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    const [clearing, payable] = await Promise.all([
      this.getPlatformAccount(AccountType.PLATFORM_GATEWAY_CLEARING),
      this.getOrCreateUserAccount(driverId, AccountType.DRIVER_COMMISSION_PAYABLE),
    ]);

    const alreadyProcessed = await this.prisma.transaction.findUnique({ where: { reference } });

    const tx = await this.postTransaction({
      type: TransactionType.RIDE_PAYMENT_CASH,
      reference,
      amount,
      metadata,
      entries: [
        { accountId: clearing.id, direction: LedgerDirection.DEBIT, amount },
        { accountId: payable.id, direction: LedgerDirection.CREDIT, amount },
      ],
    });

    if (!alreadyProcessed) {
      await this.prisma.driverStatus.updateMany({
        where: { userId: driverId },
        data: { unsettledCashRideCount: { increment: 1 } },
      });
    }

    return tx;
  }

  // A business-billed delivery completes — mirrors recordCashRideCommission
  // exactly (same DEBIT-clearing/CREDIT-payable shape), but for the FULL
  // fare rather than just a commission slice: unlike a cash ride, the
  // driver hasn't already been paid in physical cash, so the platform owes
  // them their whole cut too, not just the commission. That driver payout
  // (and platform revenue recognition) is deferred to payInvoice below,
  // once the business actually pays — never at accrual time.
  async chargeBusinessForDelivery(
    businessId: string,
    amount: Decimal,
    reference: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    const [clearing, payable] = await Promise.all([
      this.getPlatformAccount(AccountType.PLATFORM_GATEWAY_CLEARING),
      this.getOrCreateUserAccount(businessId, AccountType.BUSINESS_CREDIT_PAYABLE),
    ]);

    return this.postTransaction({
      type: TransactionType.BUSINESS_DELIVERY_ACCRUAL,
      reference,
      amount,
      metadata,
      entries: [
        { accountId: clearing.id, direction: LedgerDirection.DEBIT, amount },
        { accountId: payable.id, direction: LedgerDirection.CREDIT, amount },
      ],
    });
  }

  // Pays an invoice out of the business's own wallet balance — composed as
  // two independently-balanced transactions in one DB transaction (same
  // philosophy as the withdrawal auto-deduction composition): (1) the real
  // money movement — wallet debited, driver finally paid, platform revenue
  // recognized now that cash has actually arrived; (2) closes out the
  // payable and the clearing exposure chargeBusinessForDelivery opened at
  // accrual time. Net effect across the whole lifecycle: clearing and the
  // payable both return to exactly where they started once paid.
  async payInvoice(
    businessId: string,
    driverId: string,
    fareAmount: Decimal,
    commissionAmount: Decimal,
    reference: string,
    metadata?: Prisma.InputJsonValue,
    taxAmount: Decimal = new Prisma.Decimal(0),
  ): Promise<Transaction> {
    const driverAmount = fareAmount.minus(commissionAmount).minus(taxAmount);
    const taxLines = await this.taxEntries(taxAmount);
    const [wallet, driverAccount, platformRevenue, payable, clearing] = await Promise.all([
      this.getOrCreateUserAccount(businessId, AccountType.BUSINESS_WALLET),
      this.getOrCreateUserAccount(driverId, AccountType.DRIVER_WALLET),
      this.getPlatformAccount(AccountType.PLATFORM_REVENUE),
      this.getOrCreateUserAccount(businessId, AccountType.BUSINESS_CREDIT_PAYABLE),
      this.getPlatformAccount(AccountType.PLATFORM_GATEWAY_CLEARING),
    ]);

    return this.prisma.$transaction(async (tx) => {
      const paymentTx = await this.postTransactionEntries(tx, {
        type: TransactionType.BUSINESS_INVOICE_PAYMENT,
        reference,
        amount: fareAmount,
        metadata,
        entries: [
          { accountId: wallet.id, direction: LedgerDirection.DEBIT, amount: fareAmount },
          { accountId: driverAccount.id, direction: LedgerDirection.CREDIT, amount: driverAmount },
          {
            accountId: platformRevenue.id,
            direction: LedgerDirection.CREDIT,
            amount: commissionAmount,
          },
          ...taxLines,
        ],
      });
      await this.postTransactionEntries(tx, {
        type: TransactionType.BUSINESS_INVOICE_PAYMENT,
        reference: `${reference}:settlement`,
        amount: fareAmount,
        entries: [
          { accountId: payable.id, direction: LedgerDirection.DEBIT, amount: fareAmount },
          { accountId: clearing.id, direction: LedgerDirection.CREDIT, amount: fareAmount },
        ],
      });
      return paymentTx;
    });
  }

  // Debits the driver's wallet immediately (funds reserved, can't be
  // double-withdrawn) and marks the ledger movement COMPLETE — the
  // *external* payout lifecycle is tracked separately on WithdrawalRequest
  // and only settles or reverses once the gateway's transfer webhook lands.
  async requestWithdrawal(
    driverId: string,
    amount: Decimal,
    reference: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    const [driverAccount, clearing] = await Promise.all([
      this.getOrCreateUserAccount(driverId, AccountType.DRIVER_WALLET),
      this.getPlatformAccount(AccountType.PLATFORM_GATEWAY_CLEARING),
    ]);

    return this.postTransaction({
      type: TransactionType.WALLET_WITHDRAWAL,
      reference,
      amount,
      metadata,
      entries: [
        { accountId: driverAccount.id, direction: LedgerDirection.DEBIT, amount },
        { accountId: clearing.id, direction: LedgerDirection.CREDIT, amount },
      ],
    });
  }

  // Charging/battery-swap payment — simpler than a ride/delivery fare:
  // there's no driver counterparty earning a cut (the "driver" here is
  // platform-owned infrastructure), so the full amount goes straight to
  // PLATFORM_REVENUE. Reused for both KilowattModule payment paths.
  async payForKilowattService(
    userId: string,
    amount: Decimal,
    reference: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    const [userAccount, platformRevenue] = await Promise.all([
      this.getOrCreateUserAccount(userId, AccountType.RIDER_WALLET),
      this.getPlatformAccount(AccountType.PLATFORM_REVENUE),
    ]);

    return this.postTransaction({
      type: TransactionType.KILOWATT_PAYMENT,
      reference,
      amount,
      metadata,
      entries: [
        { accountId: userAccount.id, direction: LedgerDirection.DEBIT, amount },
        { accountId: platformRevenue.id, direction: LedgerDirection.CREDIT, amount },
      ],
    });
  }

  // A referral redemption qualifies for a payout — mirrors
  // recordCashRideCommission's exact shape (money owed, not yet paid out,
  // so clearing absorbs it). PLATFORM_REFERRAL_PAYABLE is a single
  // platform-wide liability account (aggregate amount owed to referrers
  // collectively) — the per-referrer breakdown lives in ReferralRedemption
  // rows, not in separate per-referrer ledger accounts.
  async recordReferralAccrual(
    amount: Decimal,
    reference: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    const [clearing, payable] = await Promise.all([
      this.getPlatformAccount(AccountType.PLATFORM_GATEWAY_CLEARING),
      this.getPlatformAccount(AccountType.PLATFORM_REFERRAL_PAYABLE),
    ]);

    return this.postTransaction({
      type: TransactionType.REFERRAL_PAYOUT,
      reference,
      amount,
      metadata,
      entries: [
        { accountId: clearing.id, direction: LedgerDirection.DEBIT, amount },
        { accountId: payable.id, direction: LedgerDirection.CREDIT, amount },
      ],
    });
  }

  // Pays a specific referrer out of the aggregate payable — mirrors
  // settleCommission's shape (debit the payable, credit the recipient).
  async payReferralPayout(
    referrerId: string,
    referrerAccountType: typeof AccountType.RIDER_WALLET | typeof AccountType.DRIVER_WALLET,
    amount: Decimal,
    reference: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    const [payable, referrerAccount] = await Promise.all([
      this.getPlatformAccount(AccountType.PLATFORM_REFERRAL_PAYABLE),
      this.getOrCreateUserAccount(referrerId, referrerAccountType),
    ]);

    return this.postTransaction({
      type: TransactionType.REFERRAL_PAYOUT,
      reference,
      amount,
      metadata,
      entries: [
        { accountId: payable.id, direction: LedgerDirection.DEBIT, amount },
        { accountId: referrerAccount.id, direction: LedgerDirection.CREDIT, amount },
      ],
    });
  }

  // Full reversal only (no partial refunds in this pass) — every entry on
  // the original transaction gets its direction flipped. Idempotent twice
  // over: the deterministic `refund:<id>` reference short-circuits via the
  // same duplicate-reference check every other method uses, and
  // `reversesTransactionId` is itself unique at the schema level.
  async refund(originalTransactionId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.transaction.findUnique({
        where: { id: originalTransactionId },
        include: { entries: true },
      });
      if (!original) {
        throw new NotFoundException('Transaction not found');
      }
      if (original.status === TransactionStatus.REVERSED) {
        throw new ConflictException('Transaction has already been refunded');
      }
      if (original.status !== TransactionStatus.COMPLETED) {
        throw new ConflictException('Only completed transactions can be refunded');
      }

      const refundTx = await this.postTransactionEntries(tx, {
        type: TransactionType.REFUND,
        reference: `refund:${original.id}`,
        amount: original.amount,
        currency: original.currency,
        metadata: { reason } as Prisma.InputJsonValue,
        reversesTransactionId: original.id,
        entries: original.entries.map((e) => ({
          accountId: e.accountId,
          direction:
            e.direction === LedgerDirection.DEBIT ? LedgerDirection.CREDIT : LedgerDirection.DEBIT,
          amount: e.amount,
        })),
      });

      await tx.transaction.update({
        where: { id: original.id },
        data: { status: TransactionStatus.REVERSED },
      });
      return refundTx;
    });
  }

  // Only touches PLATFORM_TAX_PAYABLE when there is tax to post, so a zero
  // tax rate never depends on that account having been seeded.
  private async taxEntries(taxAmount: Decimal) {
    if (taxAmount.lessThanOrEqualTo(0)) {
      return [];
    }
    const taxPayable = await this.getPlatformAccount(AccountType.PLATFORM_TAX_PAYABLE);
    return [{ accountId: taxPayable.id, direction: LedgerDirection.CREDIT, amount: taxAmount }];
  }

  async getTransactionsForAccount(accountId: string, take = 50, skip = 0) {
    return this.prisma.transaction.findMany({
      where: { entries: { some: { accountId } } },
      include: { entries: { where: { accountId } } },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  private async postTransaction(params: PostTransactionParams): Promise<Transaction> {
    return this.prisma.$transaction((tx) => this.postTransactionEntries(tx, params));
  }

  private async postTransactionEntries(
    tx: PrismaTx,
    params: PostTransactionParams,
  ): Promise<Transaction> {
    const existing = await tx.transaction.findUnique({ where: { reference: params.reference } });
    if (existing) {
      return existing; // already processed — safe no-op (duplicate webhook, retried request, etc.)
    }

    const totalDebits = params.entries
      .filter((e) => e.direction === LedgerDirection.DEBIT)
      .reduce((sum, e) => sum.plus(e.amount), new Prisma.Decimal(0));
    const totalCredits = params.entries
      .filter((e) => e.direction === LedgerDirection.CREDIT)
      .reduce((sum, e) => sum.plus(e.amount), new Prisma.Decimal(0));
    if (!totalDebits.equals(totalCredits)) {
      // Programmer error, not a user-facing condition — every call site in
      // this file constructs balanced entries by construction.
      throw new Error(
        `Unbalanced ledger entries: debits ${totalDebits} !== credits ${totalCredits}`,
      );
    }

    const balancesAfter = new Map<string, Decimal>();
    for (const entry of params.entries) {
      const account = await tx.account.findUniqueOrThrow({ where: { id: entry.accountId } });

      if (entry.direction === LedgerDirection.DEBIT) {
        if (account.ownerId === null) {
          // Platform/suspense account (ownerId null) — no sufficiency guard.
          // It's an internal counter tracking net gateway flow, not a
          // spendable balance a user action could overdraw; it can go
          // negative transiently (e.g. withdrawals outpacing top-ups so far).
          await tx.account.update({
            where: { id: entry.accountId },
            data: { balance: { decrement: entry.amount } },
          });
        } else {
          const result = await tx.account.updateMany({
            where: { id: entry.accountId, balance: { gte: entry.amount } },
            data: { balance: { decrement: entry.amount } },
          });
          if (result.count === 0) {
            throw new ConflictException(`Insufficient balance on account ${entry.accountId}`);
          }
        }
      } else {
        await tx.account.update({
          where: { id: entry.accountId },
          data: { balance: { increment: entry.amount } },
        });
      }

      const updated = await tx.account.findUniqueOrThrow({ where: { id: entry.accountId } });
      balancesAfter.set(entry.accountId, updated.balance);
    }

    return tx.transaction.create({
      data: {
        type: params.type,
        status: TransactionStatus.COMPLETED,
        reference: params.reference,
        idempotencyKey: params.idempotencyKey,
        amount: params.amount,
        currency: params.currency ?? 'NGN',
        metadata: params.metadata,
        reversesTransactionId: params.reversesTransactionId,
        completedAt: new Date(),
        entries: {
          create: params.entries.map((e) => ({
            accountId: e.accountId,
            direction: e.direction,
            amount: e.amount,
            balanceAfter: balancesAfter.get(e.accountId)!,
          })),
        },
      },
    });
  }
}
