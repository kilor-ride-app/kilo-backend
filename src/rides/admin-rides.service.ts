import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RideStatus } from '@prisma/client';
import { dateFilter } from '../common/dto/date-range-query.dto';
import { toPaginated } from '../common/utils/paginate.util';
import { startOfUtcDay } from '../common/utils/time-bucket.util';
import { PrismaService } from '../prisma/prisma.service';
import { ListRidesQueryDto } from './dto/list-rides-query.dto';

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

  async list(query: ListRidesQueryDto) {
    const requestedAt = dateFilter(query.from, query.to);
    const search = query.search?.trim();
    const nameContains = search
      ? { contains: search, mode: Prisma.QueryMode.insensitive }
      : undefined;

    const where: Prisma.RideWhereInput = {
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
