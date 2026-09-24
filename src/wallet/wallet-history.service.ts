import { Injectable, NotFoundException } from '@nestjs/common';
import {
  LedgerDirection,
  LedgerEntry,
  Prisma,
  TopUpMethod,
  Transaction,
  TransactionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type TransactionWithEntries = Transaction & { entries: LedgerEntry[] };

export type TransactionCategory =
  | 'TOPUP'
  | 'RIDE'
  | 'DELIVERY'
  | 'KILOWATT'
  | 'REFERRAL'
  | 'REFUND'
  | 'WITHDRAWAL'
  | 'COMMISSION'
  | 'OTHER';

// First comma-separated part of an address — "Ride to Lekki Conservation
// Centre" rather than the full geocoded string.
function shortAddress(address: string): string {
  return address.split(',')[0].trim();
}

function paymentLabel(method: TopUpMethod, last4: string | null, brand: string | null): string {
  if (method === TopUpMethod.BANK_TRANSFER) return 'Bank transfer';
  if (!last4) return 'Debit card';
  const name = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : 'Card';
  return `${name} •• ${last4}`;
}

// Turns raw ledger transactions into what the wallet screen shows:
// "Ride to Lekki Conservation Centre", "Wallet top-up · Visa •• 4821",
// signed from the account holder's side. Lookups are batched per page.
@Injectable()
export class WalletHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async listForAccount(accountId: string, take = 50, skip = 0) {
    const transactions = await this.prisma.transaction.findMany({
      where: { entries: { some: { accountId } } },
      include: { entries: { where: { accountId } } },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
    return this.describe(transactions);
  }

  async getForAccount(accountId: string, transactionId: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id: transactionId, entries: { some: { accountId } } },
      include: { entries: { where: { accountId } } },
    });
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }
    const [described] = await this.describe([transaction]);
    return described;
  }

  private async describe(transactions: TransactionWithEntries[]) {
    const ids = transactions.map((t) => t.id);
    // Top-up references can carry a ":credit"/":settle" suffix (driver
    // commission auto-deduction) — strip it to find the originating request.
    const topupRefs = transactions
      .filter((t) => t.type === TransactionType.WALLET_TOPUP)
      .map((t) => t.reference.replace(/:(credit|settle)$/, ''));

    const [rides, deliveries, swaps, topups, cancelledRides, cancelledDeliveries] =
      await Promise.all([
        this.prisma.ride.findMany({
          where: { transactionId: { in: ids } },
          select: { id: true, publicId: true, transactionId: true, dropoffAddress: true },
        }),
        this.prisma.delivery.findMany({
          where: { transactionId: { in: ids } },
          select: { id: true, publicId: true, transactionId: true, receiverName: true },
        }),
        this.prisma.batterySwapReservation.findMany({
          where: { transactionId: { in: ids } },
          select: {
            id: true,
            publicId: true,
            transactionId: true,
            station: { select: { name: true } },
          },
        }),
        topupRefs.length
          ? this.prisma.topUpRequest.findMany({ where: { reference: { in: topupRefs } } })
          : [],
        // Cancellation fees reuse the ride/delivery payment types but have
        // no transactionId link — they're keyed by reference instead.
        this.lookupCancelled('ride', transactions),
        this.lookupCancelled('delivery', transactions),
      ]);

    const rideByTx = new Map(rides.map((r) => [r.transactionId, r]));
    const deliveryByTx = new Map(deliveries.map((d) => [d.transactionId, d]));
    const swapByTx = new Map(swaps.map((s) => [s.transactionId, s]));
    const topupByRef = new Map(topups.map((t) => [t.reference, t]));

    return transactions.map((tx) => {
      // Net effect on this account: credits add, debits subtract.
      const net = tx.entries.reduce(
        (sum, e) =>
          e.direction === LedgerDirection.CREDIT ? sum.plus(e.amount) : sum.minus(e.amount),
        new Prisma.Decimal(0),
      );
      const base = {
        id: tx.id,
        publicId: tx.publicId,
        type: tx.type,
        status: tx.status,
        reference: tx.reference,
        amount: net.abs(),
        direction: net.isNegative() ? LedgerDirection.DEBIT : LedgerDirection.CREDIT,
        signedAmount: net,
        currency: tx.currency,
        createdAt: tx.createdAt,
        completedAt: tx.completedAt,
      };

      const ride = rideByTx.get(tx.id);
      const delivery = deliveryByTx.get(tx.id);
      const swap = swapByTx.get(tx.id);
      const cancelledRide = cancelledRides.get(tx.reference);
      const cancelledDelivery = cancelledDeliveries.get(tx.reference);

      switch (tx.type) {
        case TransactionType.WALLET_TOPUP: {
          const topup = topupByRef.get(tx.reference.replace(/:(credit|settle)$/, ''));
          return {
            ...base,
            category: 'TOPUP' as TransactionCategory,
            title: 'Wallet top-up',
            subtitle: topup ? paymentLabel(topup.method, topup.cardLast4, topup.cardBrand) : null,
            related: topup ? { kind: 'TOPUP', reference: topup.reference } : null,
          };
        }
        case TransactionType.RIDE_PAYMENT_WALLET:
        case TransactionType.RIDE_PAYMENT_CASH:
          return {
            ...base,
            category: 'RIDE' as TransactionCategory,
            title: ride
              ? `Ride to ${shortAddress(ride.dropoffAddress)}`
              : cancelledRide
                ? 'Ride cancellation fee'
                : 'Ride payment',
            subtitle: 'Wallet',
            related: ride
              ? { kind: 'RIDE', id: ride.id, publicId: ride.publicId }
              : cancelledRide
                ? { kind: 'RIDE', id: cancelledRide.id, publicId: cancelledRide.publicId }
                : null,
          };
        case TransactionType.DELIVERY_PAYMENT_WALLET:
        case TransactionType.DELIVERY_PAYMENT_CASH:
          return {
            ...base,
            category: 'DELIVERY' as TransactionCategory,
            title: delivery
              ? `Package delivery to ${delivery.receiverName}`
              : cancelledDelivery
                ? 'Delivery cancellation fee'
                : 'Delivery payment',
            subtitle: 'Wallet',
            related: delivery
              ? { kind: 'DELIVERY', id: delivery.id, publicId: delivery.publicId }
              : cancelledDelivery
                ? {
                    kind: 'DELIVERY',
                    id: cancelledDelivery.id,
                    publicId: cancelledDelivery.publicId,
                  }
                : null,
          };
        case TransactionType.KILOWATT_PAYMENT:
          return {
            ...base,
            category: 'KILOWATT' as TransactionCategory,
            title: swap ? `Battery swap at ${swap.station.name}` : 'Kilowatt payment',
            subtitle: 'Wallet',
            related: swap ? { kind: 'BATTERY_SWAP', id: swap.id, publicId: swap.publicId } : null,
          };
        case TransactionType.REFERRAL_PAYOUT:
          return {
            ...base,
            category: 'REFERRAL' as TransactionCategory,
            title: 'Referral bonus',
            subtitle: null,
            related: null,
          };
        case TransactionType.REFUND:
          return {
            ...base,
            category: 'REFUND' as TransactionCategory,
            title: 'Refund',
            subtitle: null,
            related: tx.reversesTransactionId
              ? { kind: 'TRANSACTION', id: tx.reversesTransactionId }
              : null,
          };
        case TransactionType.WALLET_WITHDRAWAL:
          return {
            ...base,
            category: 'WITHDRAWAL' as TransactionCategory,
            title: 'Withdrawal',
            subtitle: 'Bank transfer',
            related: null,
          };
        case TransactionType.COMMISSION_SETTLEMENT:
          return {
            ...base,
            category: 'COMMISSION' as TransactionCategory,
            title: 'Commission settlement',
            subtitle: null,
            related: null,
          };
        default:
          return {
            ...base,
            category: 'OTHER' as TransactionCategory,
            title: tx.type
              .toLowerCase()
              .split('_')
              .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
              .join(' '),
            subtitle: null,
            related: null,
          };
      }
    });
  }

  // "ride:<id>:cancellation" / "delivery:<id>:cancellation" → the booking.
  private async lookupCancelled(kind: 'ride' | 'delivery', transactions: Transaction[]) {
    const pattern = new RegExp(`^${kind}:([0-9a-f-]{36}):cancellation$`);
    const byReference = new Map<string, string>();
    for (const tx of transactions) {
      const match = pattern.exec(tx.reference);
      if (match) byReference.set(tx.reference, match[1]);
    }
    if (byReference.size === 0) {
      return new Map<string, { id: string; publicId: string }>();
    }
    const ids = [...byReference.values()];
    const rows =
      kind === 'ride'
        ? await this.prisma.ride.findMany({
            where: { id: { in: ids } },
            select: { id: true, publicId: true },
          })
        : await this.prisma.delivery.findMany({
            where: { id: { in: ids } },
            select: { id: true, publicId: true },
          });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return new Map(
      [...byReference.entries()]
        .filter(([, id]) => byId.has(id))
        .map(([ref, id]) => [ref, byId.get(id)!]),
    );
  }
}
