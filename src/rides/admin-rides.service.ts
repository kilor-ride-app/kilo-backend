import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RideStatus } from '@prisma/client';
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
import { startOfUtcDay } from '../common/utils/time-bucket.util';
import { PrismaService } from '../prisma/prisma.service';
import { ExportRidesQueryDto, ListRidesQueryDto } from './dto/list-rides-query.dto';

const ACTIVE_RIDE_STATUSES: RideStatus[] = [
  RideStatus.DISPATCHING,
  RideStatus.ACCEPTED,
  RideStatus.ARRIVED,
  RideStatus.IN_PROGRESS,
];

const PARTY_SELECT = {
  select: { id: true, firstName: true, lastName: true, phone: true },
} as const;

const RIDE_LIST_SELECT = {
  id: true,
  status: true,
  vehicleType: true,
  paymentMethod: true,
  pickupAddress: true,
  dropoffAddress: true,
  distanceKm: true,
  durationMinutes: true,
  estimatedFare: true,
  finalFare: true,
  commissionAmount: true,
  cancellationFee: true,
  requestedAt: true,
  completedAt: true,
  cancelledAt: true,
  rider: PARTY_SELECT,
  driver: PARTY_SELECT,
} as const;

// Admin read model for Ride Management. Rides have no dispute concept in the
// schema (RideStatus has no DISPUTED, and there are no dispute columns), so
// the "disputed" figure on the stats endpoint is sourced from Delivery
// disputes instead — see stats().
@Injectable()
export class AdminRidesService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(
    query: Pick<ListRidesQueryDto, 'status' | 'search' | 'from' | 'to'>,
  ): Prisma.RideWhereInput {
    const requestedAt = dateFilter(query.from, query.to);
    const search = query.search?.trim();
    const nameContains = search
      ? { contains: search, mode: Prisma.QueryMode.insensitive }
      : undefined;

    return {
      ...(query.status ? { status: query.status } : {}),
      ...(requestedAt ? { requestedAt } : {}),
      ...(search
        ? {
            OR: [
              { id: { startsWith: search } },
              { rider: { firstName: nameContains } },
              { rider: { lastName: nameContains } },
              { driver: { firstName: nameContains } },
              { driver: { lastName: nameContains } },
            ],
          }
        : {}),
    };
  }

  async list(query: ListRidesQueryDto) {
    const where = this.buildWhere(query);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.ride.findMany({
        where,
        select: RIDE_LIST_SELECT,
        orderBy: { requestedAt: 'desc' },
        take: query.take ?? 50,
        skip: query.skip ?? 0,
      }),
      this.prisma.ride.count({ where }),
    ]);

    return toPaginated(data, total, query);
  }

  async exportRides(query: ExportRidesQueryDto, actorId: string): Promise<ExportDocument> {
    const where = this.buildWhere(query);
    const [page, byStatus, settled, generatedBy] = await Promise.all([
      this.list({ ...query, take: EXPORT_MAX_ROWS, skip: 0 }),
      this.prisma.ride.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.ride.aggregate({
        where: { ...where, status: RideStatus.COMPLETED },
        _sum: { finalFare: true, commissionAmount: true },
      }),
      resolveActorName(this.prisma, actorId),
    ]);

    const counts = tallyByStatus(byStatus);
    const completed = counts[RideStatus.COMPLETED] ?? 0;
    const cancelled = counts[RideStatus.CANCELLED] ?? 0;
    const fareVolume = settled._sum.finalFare?.toNumber() ?? 0;

    return {
      title: 'Rides Report',
      subtitle: 'Individual rides with rider, driver, fare and commission',
      generatedBy,
      period: periodOf(query),
      filters: describeFilters({ Search: query.search, Status: query.status }),
      summary: [
        {
          label: 'Total rides',
          value: counts.total,
          format: 'integer',
          note: 'Rides matching the filters.',
        },
        {
          label: 'Completed',
          value: completed,
          format: 'integer',
          tone: 'good',
          note: 'Status COMPLETED.',
        },
        {
          label: 'Cancelled',
          value: cancelled,
          format: 'integer',
          tone: 'bad',
          note: 'Status CANCELLED.',
        },
        {
          label: 'In progress / other',
          value: counts.total - completed - cancelled,
          format: 'integer',
          tone: 'warn',
          note: 'Requested, dispatching, accepted, arrived, in progress or no drivers found.',
        },
        {
          label: 'Completion rate',
          value: counts.total > 0 ? completed / counts.total : null,
          format: 'percent',
          note: 'Completed ÷ total rides.',
        },
        {
          label: 'Fare volume',
          value: fareVolume,
          format: 'currency',
          tone: 'info',
          note: 'Sum of final fares on completed rides (gross, before driver payout).',
        },
        {
          label: 'Platform revenue',
          value: settled._sum.commissionAmount?.toNumber() ?? 0,
          format: 'currency',
          tone: 'good',
          note: 'Commission earned on completed rides.',
        },
        {
          label: 'Average fare',
          value: completed > 0 ? fareVolume / completed : null,
          format: 'currency',
          note: 'Fare volume ÷ completed rides.',
        },
      ],
      sections: [
        {
          name: 'Rides',
          description: 'One row per ride, newest first.',
          truncatedFrom: page.total > page.data.length ? page.total : undefined,
          columns: [
            { key: 'ref', header: 'Ride ID', width: 12 },
            { key: 'requestedAt', header: 'Requested', format: 'datetime' },
            { key: 'status', header: 'Status', format: 'status' },
            { key: 'rider', header: 'Rider', width: 22 },
            { key: 'driver', header: 'Driver', width: 22 },
            { key: 'vehicleType', header: 'Vehicle', width: 14 },
            { key: 'paymentMethod', header: 'Payment', format: 'status' },
            { key: 'pickupAddress', header: 'Pickup', width: 30 },
            { key: 'dropoffAddress', header: 'Drop-off', width: 30 },
            { key: 'distanceKm', header: 'Distance (km)', format: 'number' },
            { key: 'finalFare', header: 'Fare', format: 'currency', total: true },
            { key: 'commissionAmount', header: 'Commission', format: 'currency', total: true },
            { key: 'cancellationFee', header: 'Cancellation fee', format: 'currency', total: true },
          ],
          rows: page.data.map((r) => ({
            ...r,
            ref: r.id.slice(0, 8),
            rider: fullName(r.rider ?? {}) || '—',
            driver: fullName(r.driver ?? {}) || 'Unassigned',
          })),
        },
      ],
    };
  }

  async detail(id: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id },
      include: {
        rider: PARTY_SELECT,
        driver: PARTY_SELECT,
        rating: true,
        serviceArea: { select: { id: true, name: true } },
      },
    });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }

    const [transaction, driverRating] = await Promise.all([
      ride.transactionId
        ? this.prisma.transaction.findUnique({
            where: { id: ride.transactionId },
            select: { id: true, type: true, status: true, amount: true, reference: true },
          })
        : null,
      ride.driverId
        ? this.prisma.rideRating.aggregate({
            where: { ride: { driverId: ride.driverId } },
            _avg: { rating: true },
            _count: true,
          })
        : null,
    ]);

    const driverEarnings =
      ride.finalFare && ride.commissionAmount ? ride.finalFare.minus(ride.commissionAmount) : null;

    const steps: Array<[string, Date | null]> = [
      ['Requested', ride.requestedAt],
      ['Driver accepted', ride.acceptedAt],
      ['Driver arrived', ride.arrivedAt],
      ['Trip started', ride.startedAt],
      ['Completed', ride.completedAt],
      ['Cancelled', ride.cancelledAt],
    ];

    return {
      ...ride,
      transaction,
      driverRatingAvg: driverRating?._avg.rating ?? null,
      driverRatingCount: driverRating?._count ?? 0,
      driverEarnings,
      timeline: steps
        .filter((s): s is [string, Date] => s[1] != null)
        .map(([event, at]) => ({ event, at })),
    };
  }

  async stats() {
    const startOfToday = startOfUtcDay();
    const [
      totalToday,
      activeNow,
      completedToday,
      cancelledToday,
      revenueToday,
      disputedDeliveries,
    ] = await Promise.all([
      this.prisma.ride.count({ where: { requestedAt: { gte: startOfToday } } }),
      this.prisma.ride.count({ where: { status: { in: ACTIVE_RIDE_STATUSES } } }),
      this.prisma.ride.count({
        where: { status: RideStatus.COMPLETED, completedAt: { gte: startOfToday } },
      }),
      this.prisma.ride.count({
        where: { status: RideStatus.CANCELLED, cancelledAt: { gte: startOfToday } },
      }),
      this.prisma.ride.aggregate({
        where: { status: RideStatus.COMPLETED, completedAt: { gte: startOfToday } },
        _sum: { commissionAmount: true },
      }),
      this.prisma.delivery.count({
        where: { disputeReason: { not: null }, disputeResolvedAt: null },
      }),
    ]);

    return {
      totalToday,
      activeNow,
      completedToday,
      cancelledToday,
      revenueToday: revenueToday._sum.commissionAmount ?? new Prisma.Decimal(0),
      disputedDeliveries,
    };
  }
}
