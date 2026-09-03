import { Injectable } from '@nestjs/common';
import {
  AccountType,
  DeliveryStatus,
  Prisma,
  RideStatus,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { dateFilter } from '../common/dto/date-range-query.dto';
import { toPaginated } from '../common/utils/paginate.util';
import {
  AnalyticsRange,
  foldSeries,
  rangeMeta,
  rangeWindow,
  startOfUtcDay,
  truncExpr,
} from '../common/utils/time-bucket.util';
import { PrismaService } from '../prisma/prisma.service';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { ListWithdrawalsQueryDto } from './dto/list-withdrawals-query.dto';

const D0 = () => new Prisma.Decimal(0);
const WALLET_TYPES = [AccountType.RIDER_WALLET, AccountType.DRIVER_WALLET];

// Aggregations behind the Wallet & Finance dashboard. Read-only — the actual
// withdrawal payout lifecycle lives in PaymentsService; this only surfaces
// the queue and rolls up numbers.
@Injectable()
export class AdminFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async stats() {
    const startOfToday = startOfUtcDay();
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);

    const [
      walletPool,
      todayTopups,
      pendingWithdrawals,
      rideCommissionToday,
      deliveryCommissionToday,
      driversOutstanding,
      refundsThisWeek,
    ] = await Promise.all([
      this.prisma.account.aggregate({
        where: { type: { in: WALLET_TYPES } },
        _sum: { balance: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          type: TransactionType.WALLET_TOPUP,
          status: TransactionStatus.COMPLETED,
          completedAt: { gte: startOfToday },
        },
        _sum: { amount: true },
      }),
      this.prisma.withdrawalRequest.aggregate({
        where: { status: TransactionStatus.PENDING },
        _count: true,
        _sum: { amount: true },
      }),
      this.prisma.ride.aggregate({
        where: { status: RideStatus.COMPLETED, completedAt: { gte: startOfToday } },
        _sum: { commissionAmount: true },
      }),
      this.prisma.delivery.aggregate({
        where: { status: DeliveryStatus.COMPLETED, completedAt: { gte: startOfToday } },
        _sum: { commissionAmount: true },
      }),
      this.prisma.account.aggregate({
        where: { type: AccountType.DRIVER_COMMISSION_PAYABLE },
        _sum: { balance: true },
      }),
      this.prisma.transaction.aggregate({
        where: { type: TransactionType.REFUND, createdAt: { gte: weekAgo } },
        _sum: { amount: true },
      }),
    ]);

    return {
      walletPool: walletPool._sum.balance ?? D0(),
      todayTopups: todayTopups._sum.amount ?? D0(),
      pendingWithdrawals: {
        count: pendingWithdrawals._count,
        amount: pendingWithdrawals._sum.amount ?? D0(),
      },
      platformCommissionToday: (rideCommissionToday._sum.commissionAmount ?? D0()).plus(
        deliveryCommissionToday._sum.commissionAmount ?? D0(),
      ),
      driversOutstanding: driversOutstanding._sum.balance ?? D0(),
      refundsThisWeek: refundsThisWeek._sum.amount ?? D0(),
    };
  }

  async listWithdrawals(query: ListWithdrawalsQueryDto) {
    const where: Prisma.WithdrawalRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.withdrawalRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.take ?? 50,
        skip: query.skip ?? 0,
      }),
      this.prisma.withdrawalRequest.count({ where }),
    ]);

    // Bank name / account number aren't in the schema (bankAccountId is only
    // a Paystack recipient code) — the driver identity is the most the queue
    // can show.
    const driverIds = [...new Set(rows.map((r) => r.driverId))];
    const drivers = driverIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: driverIds } },
          select: { id: true, firstName: true, lastName: true, phone: true },
        })
      : [];
    const byId = new Map(drivers.map((d) => [d.id, d]));

    return toPaginated(
      rows.map((r) => ({ ...r, driver: byId.get(r.driverId) ?? null })),
      total,
      query,
    );
  }

  async listTransactions(query: ListTransactionsQueryDto) {
    const createdAt = dateFilter(query.from, query.to);
    const where: Prisma.TransactionWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(query.search
        ? { reference: { contains: query.search, mode: Prisma.QueryMode.insensitive } }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        include: { entries: true },
        orderBy: { createdAt: 'desc' },
        take: query.take ?? 50,
        skip: query.skip ?? 0,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return toPaginated(data, total, query);
  }

  async revenueByService(range: AnalyticsRange) {
    const { from, to } = rangeWindow(range);
    const [rides, deliveries, kilowatt] = await Promise.all([
      this.prisma.ride.aggregate({
        where: { status: RideStatus.COMPLETED, completedAt: { gte: from, lt: to } },
        _sum: { commissionAmount: true },
      }),
      this.prisma.delivery.aggregate({
        where: { status: DeliveryStatus.COMPLETED, completedAt: { gte: from, lt: to } },
        _sum: { commissionAmount: true },
      }),
      // Kilowatt has no separate commission ledger entry — the full payment
      // is counted here.
      this.prisma.transaction.aggregate({
        where: {
          type: TransactionType.KILOWATT_PAYMENT,
          status: TransactionStatus.COMPLETED,
          completedAt: { gte: from, lt: to },
        },
        _sum: { amount: true },
      }),
    ]);

    return [
      { service: 'RIDE', revenue: rides._sum.commissionAmount ?? D0() },
      { service: 'DELIVERY', revenue: deliveries._sum.commissionAmount ?? D0() },
      { service: 'KILOWATT', revenue: kilowatt._sum.amount ?? D0() },
    ];
  }

  async topupTrend(range: AnalyticsRange) {
    const { unit } = rangeMeta(range);
    const { from, to } = rangeWindow(range);
    const bucketExpr = Prisma.raw(truncExpr(unit, '"completedAt"'));

    const rows = await this.prisma.$queryRaw<Array<{ bucket: string | null; value: number }>>`
      SELECT ${bucketExpr} AS bucket, COALESCE(SUM("amount"), 0)::float8 AS value
      FROM "transactions"
      WHERE "type" = 'WALLET_TOPUP' AND "status" = 'COMPLETED'
        AND "completedAt" >= ${from} AND "completedAt" < ${to}
      GROUP BY 1
    `;

    return foldSeries(range, rows).map((b) => ({
      label: b.label,
      start: b.start,
      volume: b.value,
    }));
  }
}
