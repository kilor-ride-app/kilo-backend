import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AccountType,
  DeliveryStatus,
  DriverAvailability,
  InvoiceStatus,
  ReportFormat,
  ReportType,
  RideOfferStatus,
  RideStatus,
  ScheduleFrequency,
  TicketStatus,
  TransactionType,
  UserRole,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { resolveActorName } from '../common/export/export-helpers';
import { ExportDocument, ExportFormat } from '../common/export/export.types';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { buildReportDocument } from './report-documents';

export const REPORTS_QUEUE = 'reports';
export const SCHEDULED_REPORT_JOB = 'generate-and-send';

// Fixed times rather than admin-supplied cron strings — keeps the DTO
// simple and avoids validating arbitrary cron syntax from API input.
const FREQUENCY_CRON: Record<ScheduleFrequency, string> = {
  DAILY: '0 6 * * *', // every day at 06:00
  WEEKLY: '0 6 * * 1', // every Monday at 06:00
  MONTHLY: '0 6 1 * *', // 1st of the month at 06:00
};

export interface ReportPeriod {
  from: Date;
  to: Date;
}

// Every report generator returns a flat array of row objects — a
// single-element array for one-summary-block reports (riders, drivers,
// finance, ...), multiple rows for naturally tabular ones (logistics by
// vehicle type, business invoices, ...). One shape serves both the GET
// JSON response and CSV export (see toCsv) without a separate mapping layer.
type ReportRows = Record<string, unknown>[];

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    @InjectQueue(REPORTS_QUEUE) private readonly queue: Queue,
  ) {}

  async scheduleReport(
    createdById: string,
    dto: {
      type: ReportType;
      format: ReportFormat;
      frequency: ScheduleFrequency;
      recipientEmail: string;
    },
  ) {
    const schedule = await this.prisma.scheduledReport.create({
      data: {
        type: dto.type,
        format: dto.format,
        frequency: dto.frequency,
        recipientEmail: dto.recipientEmail,
        createdById,
      },
    });

    // jobId tied to the schedule's own id — BullMQ dedupes repeatable jobs
    // by (name, jobId, pattern), so re-registering the same schedule is a
    // safe no-op rather than a duplicate.
    await this.queue.add(
      SCHEDULED_REPORT_JOB,
      { scheduledReportId: schedule.id },
      { repeat: { pattern: FREQUENCY_CRON[dto.frequency] }, jobId: schedule.id },
    );

    return schedule;
  }

  resolvePeriod(from?: string, to?: string): ReportPeriod {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('Invalid from/to date');
    }
    return { from: fromDate, to: toDate };
  }

  async generate(type: ReportType, period: ReportPeriod): Promise<ReportRows> {
    switch (type) {
      case ReportType.RIDERS:
        return this.ridersReport(period);
      case ReportType.DRIVERS:
        return this.driversReport(period);
      case ReportType.RIDES:
        return this.ridesReport(period);
      case ReportType.LOGISTICS:
        return this.logisticsReport(period);
      case ReportType.BUSINESS:
        return this.businessReport(period);
      case ReportType.KILOWATT:
        return this.kilowattReport(period);
      case ReportType.FINANCE:
        return this.financeReport(period);
      case ReportType.SUPPORT:
        return this.supportReport(period);
    }
  }

  async ridersReport({ from, to }: ReportPeriod): Promise<ReportRows> {
    const [totalRiders, newRiders, activeRiderIds] = await Promise.all([
      this.prisma.user.count({ where: { role: UserRole.RIDER } }),
      this.prisma.user.count({
        where: { role: UserRole.RIDER, createdAt: { gte: from, lte: to } },
      }),
      this.prisma.ride.findMany({
        where: { requestedAt: { gte: from, lte: to } },
        select: { riderId: true },
        distinct: ['riderId'],
      }),
    ]);
    return [
      {
        totalRiders,
        newRidersInPeriod: newRiders,
        activeRidersInPeriod: activeRiderIds.length,
        periodFrom: from,
        periodTo: to,
      },
    ];
  }

  async driversReport({ from, to }: ReportPeriod): Promise<ReportRows> {
    const [totalDrivers, onlineDrivers, offersInPeriod, completedRides] = await Promise.all([
      this.prisma.user.count({ where: { role: UserRole.DRIVER } }),
      this.prisma.driverStatus.count({
        where: { availability: { not: DriverAvailability.OFFLINE } },
      }),
      this.prisma.rideOffer.groupBy({
        by: ['status'],
        where: { createdAt: { gte: from, lte: to } },
        _count: true,
      }),
      this.prisma.ride.count({
        where: { status: RideStatus.COMPLETED, completedAt: { gte: from, lte: to } },
      }),
    ]);

    const accepted = offersInPeriod.find((o) => o.status === RideOfferStatus.ACCEPTED)?._count ?? 0;
    const totalOffers = offersInPeriod.reduce((sum, o) => sum + o._count, 0);
    const acceptanceRate = totalOffers > 0 ? accepted / totalOffers : null;

    return [
      {
        totalDrivers,
        onlineDrivers,
        completedRidesInPeriod: completedRides,
        offerAcceptanceRate: acceptanceRate,
        periodFrom: from,
        periodTo: to,
      },
    ];
  }

  async ridesReport({ from, to }: ReportPeriod): Promise<ReportRows> {
    const statusCounts = await this.prisma.ride.groupBy({
      by: ['status'],
      where: { requestedAt: { gte: from, lte: to } },
      _count: true,
    });
    const completed = statusCounts.find((s) => s.status === RideStatus.COMPLETED)?._count ?? 0;
    const total = statusCounts.reduce((sum, s) => sum + s._count, 0);

    const revenue = await this.prisma.ride.aggregate({
      where: { status: RideStatus.COMPLETED, completedAt: { gte: from, lte: to } },
      _sum: { commissionAmount: true, finalFare: true },
    });

    return [
      {
        totalRides: total,
        completedRides: completed,
        completionRate: total > 0 ? completed / total : null,
        totalRevenue: revenue._sum.commissionAmount ?? 0,
        totalFareVolume: revenue._sum.finalFare ?? 0,
        revenuePerCompletedRide:
          completed > 0 && revenue._sum.commissionAmount
            ? revenue._sum.commissionAmount.dividedBy(completed)
            : null,
        periodFrom: from,
        periodTo: to,
        ...Object.fromEntries(statusCounts.map((s) => [`status_${s.status}`, s._count])),
      },
    ];
  }

  async logisticsReport({ from, to }: ReportPeriod): Promise<ReportRows> {
    const byVehicleType = await this.prisma.delivery.groupBy({
      by: ['vehicleType', 'status'],
      where: { requestedAt: { gte: from, lte: to } },
      _count: true,
    });

    const vehicleTypes = [...new Set(byVehicleType.map((r) => r.vehicleType))];
    return vehicleTypes.map((vehicleType) => {
      const rows = byVehicleType.filter((r) => r.vehicleType === vehicleType);
      const total = rows.reduce((sum, r) => sum + r._count, 0);
      const completed = rows.find((r) => r.status === DeliveryStatus.COMPLETED)?._count ?? 0;
      return {
        vehicleType,
        totalDeliveries: total,
        completedDeliveries: completed,
        successRate: total > 0 ? completed / total : null,
        periodFrom: from,
        periodTo: to,
      };
    });
  }

  async businessReport({ from, to }: ReportPeriod): Promise<ReportRows> {
    const [totalBusinesses, invoicesInPeriod] = await Promise.all([
      this.prisma.business.count(),
      this.prisma.invoice.groupBy({
        by: ['status'],
        where: { createdAt: { gte: from, lte: to } },
        _count: true,
        _sum: { amount: true },
      }),
    ]);

    const paid = invoicesInPeriod.find((i) => i.status === InvoiceStatus.PAID);

    return [
      {
        totalBusinesses,
        invoicesInPeriod: invoicesInPeriod.reduce((sum, i) => sum + i._count, 0),
        paidInvoices: paid?._count ?? 0,
        totalInvoicedAmount: invoicesInPeriod.reduce(
          (sum, i) => (i._sum.amount ? sum + i._sum.amount.toNumber() : sum),
          0,
        ),
        totalPaidAmount: paid?._sum.amount ?? 0,
        periodFrom: from,
        periodTo: to,
      },
    ];
  }

  async kilowattReport({ from, to }: ReportPeriod): Promise<ReportRows> {
    const [activeChargingStations, swapReservations, solarLeadsByStatus] = await Promise.all([
      this.prisma.chargingStation.count({ where: { isActive: true } }),
      this.prisma.batterySwapReservation.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.prisma.solarAssessment.groupBy({
        by: ['status'],
        where: { createdAt: { gte: from, lte: to } },
        _count: true,
      }),
    ]);

    return [
      {
        activeChargingStations,
        swapReservationsInPeriod: swapReservations,
        solarLeadsInPeriod: solarLeadsByStatus.reduce((sum, s) => sum + s._count, 0),
        periodFrom: from,
        periodTo: to,
        ...Object.fromEntries(solarLeadsByStatus.map((s) => [`solarLeads_${s.status}`, s._count])),
      },
    ];
  }

  async financeReport({ from, to }: ReportPeriod): Promise<ReportRows> {
    const [platformRevenue, txByType] = await Promise.all([
      this.wallet.getPlatformAccount(AccountType.PLATFORM_REVENUE),
      this.prisma.transaction.groupBy({
        by: ['type'],
        where: { createdAt: { gte: from, lte: to } },
        _count: true,
        _sum: { amount: true },
      }),
    ]);

    const withdrawals = txByType.find((t) => t.type === TransactionType.WALLET_WITHDRAWAL);

    return [
      {
        totalRecognizedRevenue: platformRevenue.balance,
        transactionVolumeInPeriod: txByType.reduce((sum, t) => sum + t._count, 0),
        totalWithdrawalsInPeriod: withdrawals?._sum.amount ?? 0,
        periodFrom: from,
        periodTo: to,
        ...Object.fromEntries(
          txByType.map((t) => [`amount_${t.type}`, t._sum.amount?.toString() ?? '0']),
        ),
        ...Object.fromEntries(txByType.map((t) => [`count_${t.type}`, t._count])),
      },
    ];
  }

  async supportReport({ from, to }: ReportPeriod): Promise<ReportRows> {
    const [byStatus, resolvedTickets] = await Promise.all([
      this.prisma.supportTicket.groupBy({
        by: ['status'],
        where: { createdAt: { gte: from, lte: to } },
        _count: true,
      }),
      this.prisma.supportTicket.findMany({
        where: { status: TicketStatus.RESOLVED, resolvedAt: { gte: from, lte: to } },
        select: { createdAt: true, resolvedAt: true },
      }),
    ]);

    const resolutionTimesMs = resolvedTickets
      .filter((t) => t.resolvedAt)
      .map((t) => t.resolvedAt!.getTime() - t.createdAt.getTime());
    const avgResolutionHours =
      resolutionTimesMs.length > 0
        ? resolutionTimesMs.reduce((a, b) => a + b, 0) / resolutionTimesMs.length / (1000 * 60 * 60)
        : null;

    return [
      {
        totalTicketsInPeriod: byStatus.reduce((sum, s) => sum + s._count, 0),
        resolvedInPeriod: resolvedTickets.length,
        avgResolutionHours,
        // No CSAT rating is captured on SupportTicket in this pass — not
        // fabricated here, deliberately omitted rather than faked.
        periodFrom: from,
        periodTo: to,
        ...Object.fromEntries(byStatus.map((s) => [`status_${s.status}`, s._count])),
      },
    ];
  }

  /** Name for the "Generated by" line of an export. */
  actorName(actorId: string | undefined): Promise<string> {
    return resolveActorName(this.prisma, actorId);
  }

  /**
   * The documented export (labelled metrics, breakdown tables) for a report.
   * Built from the same generators as the JSON endpoints, so an exported
   * figure always matches the on-screen one.
   */
  async buildExportDocument(
    type: ReportType,
    period: ReportPeriod,
    generatedBy: string,
  ): Promise<ExportDocument> {
    const rows = await this.generate(type, period);
    return buildReportDocument(type, rows, period, generatedBy);
  }
}

/** Prisma's ReportFormat (CSV/PDF/XLSX) -> the export layer's lowercase format. */
export function toExportFormat(format: ReportFormat): ExportFormat {
  return format.toLowerCase() as ExportFormat;
}
