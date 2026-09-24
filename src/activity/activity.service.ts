import { Injectable } from '@nestjs/common';
import {
  BatterySwapReservationStatus,
  DeliveryServiceType,
  DeliveryStatus,
  Prisma,
  RideStatus,
} from '@prisma/client';
import { DriverCard, DriverProfilesService } from '../drivers/driver-profiles.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityFilter } from './dto/list-activity-query.dto';

const ONGOING_RIDE: RideStatus[] = [
  RideStatus.REQUESTED,
  RideStatus.DISPATCHING,
  RideStatus.ACCEPTED,
  RideStatus.ARRIVED,
  RideStatus.IN_PROGRESS,
];
const ONGOING_DELIVERY: DeliveryStatus[] = [
  DeliveryStatus.SCHEDULED,
  DeliveryStatus.REQUESTED,
  DeliveryStatus.DISPATCHING,
  DeliveryStatus.ACCEPTED,
  DeliveryStatus.PICKED_UP,
];
const ONGOING_SWAP: BatterySwapReservationStatus[] = [BatterySwapReservationStatus.CONFIRMED];

export type ActivityKind = 'RIDE' | 'DELIVERY' | 'BATTERY_SWAP';

export interface ActivityItem {
  kind: ActivityKind;
  id: string;
  publicId: string; // shown as the reference on the detail sheet
  title: string; // "Ride to Landmark Beach", "Package to Ella Damien"
  status: string;
  amount: Prisma.Decimal | null; // final if settled, otherwise the estimate
  paymentMethod: string | null;
  createdAt: Date;
  completedAt: Date | null;
  // Deliveries in transit: pickup time + route duration ("Arriving by 3:30pm").
  estimatedArrivalAt: Date | null;
  scheduledFor: Date | null;
  driver: Omit<DriverCard, 'phone' | 'ratingCount' | 'tripCount'> | null;
}

function shortAddress(address: string): string {
  return address.split(',')[0].trim();
}

// The Activity tab: rides, deliveries and Kilowatt bookings in one list,
// with anything still in progress pulled out into `ongoing`.
@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly driverProfiles: DriverProfilesService,
  ) {}

  async list(userId: string, filter: ActivityFilter = 'ALL', take = 50, skip = 0) {
    const want = (kind: ActivityKind) =>
      filter === 'ALL' ||
      (filter === 'RIDES' && kind === 'RIDE') ||
      (filter === 'DELIVERIES' && kind === 'DELIVERY') ||
      (filter === 'KILOWATT' && kind === 'BATTERY_SWAP');

    // Past items are paginated across three tables: pull the first
    // skip+take of each (all newest-first), merge, then slice. Cheap at the
    // page sizes the app uses; ongoing items are few and returned in full.
    const window = skip + take;
    const [ongoing, past, total] = await Promise.all([
      this.fetch(userId, want, 'ongoing'),
      this.fetch(userId, want, 'past', window),
      this.countPast(userId, want),
    ]);

    const items = past
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(skip, skip + take);
    const withDrivers = await this.attachDrivers([...ongoing, ...items]);

    return {
      ongoing: withDrivers.slice(0, ongoing.length),
      items: withDrivers.slice(ongoing.length),
      total,
      take,
      skip,
    };
  }

  private async fetch(
    userId: string,
    want: (kind: ActivityKind) => boolean,
    phase: 'ongoing' | 'past',
    limit?: number,
  ): Promise<Array<ActivityItem & { driverId: string | null }>> {
    const pick = <T>(inOngoing: T[]) =>
      phase === 'ongoing' ? { in: inOngoing } : { notIn: inOngoing };

    const [rides, deliveries, swaps] = await Promise.all([
      want('RIDE')
        ? this.prisma.ride.findMany({
            where: { riderId: userId, status: pick(ONGOING_RIDE) },
            orderBy: { requestedAt: 'desc' },
            take: limit,
          })
        : [],
      want('DELIVERY')
        ? this.prisma.delivery.findMany({
            where: { senderId: userId, status: pick(ONGOING_DELIVERY) },
            orderBy: { requestedAt: 'desc' },
            take: limit,
          })
        : [],
      want('BATTERY_SWAP')
        ? this.prisma.batterySwapReservation.findMany({
            where: { userId, status: pick(ONGOING_SWAP) },
            include: { station: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
            take: limit,
          })
        : [],
    ]);

    return [
      ...rides.map((r) => ({
        kind: 'RIDE' as const,
        id: r.id,
        publicId: r.publicId,
        title: `Ride to ${shortAddress(r.dropoffAddress)}`,
        status: r.status,
        amount: r.finalFare ?? r.estimatedFare,
        paymentMethod: r.paymentMethod,
        createdAt: r.requestedAt,
        completedAt: r.completedAt,
        estimatedArrivalAt:
          r.startedAt && r.durationMinutes
            ? new Date(r.startedAt.getTime() + r.durationMinutes * 60_000)
            : null,
        scheduledFor: null,
        driverId: r.driverId,
        driver: null,
      })),
      ...deliveries.map((d) => ({
        kind: 'DELIVERY' as const,
        id: d.id,
        publicId: d.publicId,
        title: `${d.serviceType === DeliveryServiceType.FREIGHT ? 'Freight' : 'Package'} to ${d.receiverName}`,
        status: d.status,
        amount: d.finalFare ?? d.estimatedFare,
        paymentMethod: d.paymentMethod,
        createdAt: d.requestedAt,
        completedAt: d.completedAt,
        estimatedArrivalAt:
          d.pickedUpAt && d.durationMinutes
            ? new Date(d.pickedUpAt.getTime() + d.durationMinutes * 60_000)
            : null,
        scheduledFor: d.scheduledFor,
        driverId: d.driverId,
        driver: null,
      })),
      ...swaps.map((s) => ({
        kind: 'BATTERY_SWAP' as const,
        id: s.id,
        publicId: s.publicId,
        title: `Battery swap at ${s.station.name}`,
        status: s.status,
        amount: s.amount,
        paymentMethod: 'WALLET',
        createdAt: s.createdAt,
        completedAt: s.completedAt,
        estimatedArrivalAt: null,
        scheduledFor: null,
        driverId: null,
        driver: null,
      })),
    ];
  }

  private async countPast(userId: string, want: (kind: ActivityKind) => boolean) {
    const [rides, deliveries, swaps] = await Promise.all([
      want('RIDE')
        ? this.prisma.ride.count({ where: { riderId: userId, status: { notIn: ONGOING_RIDE } } })
        : 0,
      want('DELIVERY')
        ? this.prisma.delivery.count({
            where: { senderId: userId, status: { notIn: ONGOING_DELIVERY } },
          })
        : 0,
      want('BATTERY_SWAP')
        ? this.prisma.batterySwapReservation.count({
            where: { userId, status: { notIn: ONGOING_SWAP } },
          })
        : 0,
    ]);
    return rides + deliveries + swaps;
  }

  private async attachDrivers(
    items: Array<ActivityItem & { driverId: string | null }>,
  ): Promise<ActivityItem[]> {
    const cards = await this.driverProfiles.getDriverCards(
      items.map((i) => i.driverId).filter((id): id is string => !!id),
    );
    return items.map(({ driverId, ...item }) => {
      const card = driverId ? cards.get(driverId) : undefined;
      return {
        ...item,
        driver: card
          ? {
              id: card.id,
              firstName: card.firstName,
              lastName: card.lastName,
              profilePhotoUrl: card.profilePhotoUrl,
              rating: card.rating,
              vehicle: card.vehicle,
            }
          : null,
      };
    });
  }
}
