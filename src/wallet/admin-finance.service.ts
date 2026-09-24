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
import {
  describeFilters,
  fullName,
  periodOf,
  resolveActorName,
} from '../common/export/export-helpers';
import { EXPORT_MAX_ROWS, ExportDocument } from '../common/export/export.types';
import { toPaginated } from '../common/utils/paginate.util';
import { tallyByStatus } from '../common/utils/tally.util';
import {
  AnalyticsRange,
  foldSeries,
  rangeMeta,
  rangeWindow,
  startOfUtcDay,
  truncExpr,
} from '../common/utils/time-bucket.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  ExportTransactionsQueryDto,
  ListTransactionsQueryDto,
} from './dto/list-transactions-query.dto';
import {
  ExportWithdrawalsQueryDto,
  ListWithdrawalsQueryDto,
} from './dto/list-withdrawals-query.dto';

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
          select: { id: true, publicId: true, firstName: true, lastName: true, phone: true },
        })
      : [];
    const byId = new Map(drivers.map((d) => [d.id, d]));

    return toPaginated(
      rows.map((r) => ({ ...r, driver: byId.get(r.driverId) ?? null })),
      total,
      query,
    );
  }

  private transactionWhere(
    query: Pick<ListTransactionsQueryDto, 'type' | 'status' | 'from' | 'to' | 'search'>,
  ): Prisma.TransactionWhereInput {
    const createdAt = dateFilter(query.from, query.to);
    return {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(query.search
        ? {
            OR: [
              { publicId: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
              { reference: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
            ],
          }
        : {}),
    };
  }

  async listTransactions(query: ListTransactionsQueryDto) {
    const where = this.transactionWhere(query);

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

  async exportTransactions(
    query: ExportTransactionsQueryDto,
    actorId: string,
  ): Promise<ExportDocument> {
    const where = this.transactionWhere(query);
    const [rows, total, byStatus, generatedBy] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: EXPORT_MAX_ROWS,
      }),
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.groupBy({
        by: ['status'],
        where,
        _count: true,
        _sum: { amount: true },
      }),
      resolveActorName(this.prisma, actorId),
    ]);
    const counts = tallyByStatus(byStatus);
    const completedValue = byStatus.find((r) => r.status === TransactionStatus.COMPLETED)?._sum
      .amount;

    return {
      title: 'Transactions Report',
      subtitle: 'Wallet and ledger transactions',
      generatedBy,
      period: periodOf(query),
      filters: describeFilters({
        Type: query.type,
        Status: query.status,
        Search: query.search,
      }),
      summary: [
        {
          label: 'Total transactions',
          value: counts.total,
          format: 'integer',
          note: 'Transactions matching the filters.',
        },
        {
          label: 'Completed',
          value: counts[TransactionStatus.COMPLETED] ?? 0,
          format: 'integer',
          tone: 'good',
          note: 'Ledger entries posted, balances updated.',
        },
        {
          label: 'Pending',
          value: counts[TransactionStatus.PENDING] ?? 0,
          format: 'integer',
          tone: 'warn',
          note: 'Awaiting external confirmation (e.g. gateway webhook).',
        },
        {
          label: 'Failed',
          value: counts[TransactionStatus.FAILED] ?? 0,
          format: 'integer',
          tone: 'bad',
          note: 'Did not complete; no ledger entries posted.',
        },
        {
          label: 'Reversed',
          value: counts[TransactionStatus.REVERSED] ?? 0,
          format: 'integer',
          note: 'Completed, then reversed by a refund or adjustment.',
        },
        {
          label: 'Completed value',
          value: completedValue?.toNumber() ?? 0,
          format: 'currency',
          tone: 'info',
          note: 'Gross value of completed transactions, all types combined (top-ups and payouts both count).',
        },
      ],
      sections: [
        {
          name: 'Transactions',
          description: 'One row per transaction, newest first.',
          truncatedFrom: total > rows.length ? total : undefined,
          columns: [
            { key: 'createdAt', header: 'Created', format: 'datetime' },
            { key: 'reference', header: 'Reference', width: 34 },
            { key: 'type', header: 'Type', format: 'status', width: 22 },
            { key: 'status', header: 'Status', format: 'status' },
            { key: 'amount', header: 'Amount', format: 'currency' },
            { key: 'completedAt', header: 'Completed', format: 'datetime' },
          ],
          rows,
        },
      ],
    };
  }

  async exportWithdrawals(
    query: ExportWithdrawalsQueryDto,
    actorId: string,
  ): Promise<ExportDocument> {
    const where: Prisma.WithdrawalRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
    };
    const [page, byStatus, generatedBy] = await Promise.all([
      this.listWithdrawals({ ...query, take: EXPORT_MAX_ROWS, skip: 0 }),
      this.prisma.withdrawalRequest.groupBy({
        by: ['status'],
        where,
        _count: true,
        _sum: { amount: true, settledCommission: true },
      }),
      resolveActorName(this.prisma, actorId),
    ]);
    const counts = tallyByStatus(byStatus);
    const sumOf = (status: TransactionStatus) =>
      byStatus.find((r) => r.status === status)?._sum.amount?.toNumber() ?? 0;
    const commission = byStatus.reduce(
      (acc, r) => acc + (r._sum.settledCommission?.toNumber() ?? 0),
      0,
    );

    return {
      title: 'Driver Withdrawals Report',
      subtitle: 'Payout requests, approval queue and commission auto-settled',
      generatedBy,
      filters: describeFilters({ Status: query.status }),
      summary: [
        {
          label: 'Total requests',
          value: counts.total,
          format: 'integer',
          note: 'Withdrawal requests matching the filters.',
        },
        {
          label: 'Pending requests',
          value: counts[TransactionStatus.PENDING] ?? 0,
          format: 'integer',
          tone: 'warn',
          note: 'The approval queue.',
        },
        {
          label: 'Pending amount',
          value: sumOf(TransactionStatus.PENDING),
          format: 'currency',
          tone: 'warn',
          note: 'Total value waiting to be paid out.',
        },
        {
          label: 'Paid out',
          value: sumOf(TransactionStatus.COMPLETED),
          format: 'currency',
          tone: 'good',
          note: 'Requested amount on completed withdrawals.',
        },
        {
          label: 'Failed requests',
          value: counts[TransactionStatus.FAILED] ?? 0,
          format: 'integer',
          tone: 'bad',
          note: 'Payouts that did not complete.',
        },
        {
          label: 'Commission auto-settled',
          value: commission,
          format: 'currency',
          tone: 'info',
          note: 'Outstanding cash-ride commission deducted from withdrawals before payout.',
        },
      ],
      sections: [
        {
          name: 'Withdrawals',
          description:
            'One row per request, newest first. Net payout = requested amount − commission settled.',
          truncatedFrom: page.total > page.data.length ? page.total : undefined,
          columns: [
            { key: 'createdAt', header: 'Requested', format: 'datetime' },
            { key: 'driverName', header: 'Driver', width: 24 },
            { key: 'driverPhone', header: 'Phone', width: 16 },
            { key: 'amount', header: 'Amount requested', format: 'currency', total: true },
            {
              key: 'settledCommission',
              header: 'Commission settled',
              format: 'currency',
              total: true,
            },
            { key: 'netPayout', header: 'Net payout', format: 'currency', total: true },
            { key: 'status', header: 'Status', format: 'status' },
            { key: 'completedAt', header: 'Completed', format: 'datetime' },
            { key: 'gatewayReference', header: 'Gateway reference', width: 28 },
          ],
          rows: page.data.map((r) => ({
            ...r,
            driverName: fullName(r.driver ?? {}) || '—',
            driverPhone: r.driver?.phone ?? '',
            netPayout: r.amount.minus(r.settledCommission),
          })),
        },
      ],
    };
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
