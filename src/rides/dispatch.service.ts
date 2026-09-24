import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryStatus,
  DriverAvailability,
  DriverServiceMode,
  RideOfferStatus,
  RidePaymentMethod,
  RideStatus,
} from '@prisma/client';
import { NotificationCategory } from '../notifications/notification-categories';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { DriverOffersGateway } from './gateways/driver-offers.gateway';
import { RideTrackingGateway } from './gateways/ride-tracking.gateway';

const GEO_KEY = 'drivers:geo';
const SEARCH_RADIUS_KM = 5;
const OFFER_TTL_MS = 15_000;
const MAX_CANDIDATES = 5;
// A driver with this many CASH rides completed since their commission debt
// was last fully cleared stops receiving cash-ride offers entirely, until
// WalletService.settleCommission brings the balance back to zero. Default
// when admin hasn't set an override via PlatformConfig.
const DEFAULT_MAX_UNSETTLED_CASH_RIDES = 3;
const MAX_UNSETTLED_CASH_RIDES_CONFIG_KEY = 'maxUnsettledCashRides';

// Live driver location never touches Postgres on the write path (plan.md
// Section 8) — GEOADD into Redis on every ping, Postgres only ever sees
// state transitions (DriverStatus rows), never per-ping writes.
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly driverOffers: DriverOffersGateway,
    private readonly rideTracking: RideTrackingGateway,
    private readonly platformConfig: PlatformConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  private getMaxUnsettledCashRides(): Promise<number> {
    return this.platformConfig.get(
      MAX_UNSETTLED_CASH_RIDES_CONFIG_KEY,
      DEFAULT_MAX_UNSETTLED_CASH_RIDES,
    );
  }

  async setDriverStatus(
    driverId: string,
    availability: DriverAvailability,
    vehicleType?: string,
    serviceMode?: DriverServiceMode,
  ) {
    const status = await this.prisma.driverStatus.upsert({
      where: { userId: driverId },
      update: {
        availability,
        ...(vehicleType ? { vehicleType } : {}),
        ...(serviceMode ? { serviceMode } : {}),
      },
      create: { userId: driverId, availability, vehicleType, serviceMode },
    });
    if (availability === DriverAvailability.OFFLINE) {
      await this.redis.client.zrem(GEO_KEY, driverId);
    }
    return status;
  }

  async pushLocation(driverId: string, lat: number, lng: number) {
    await this.redis.client.geoadd(GEO_KEY, lng, lat, driverId);

    // Fan out to whoever's tracking this driver's current ride, if any.
    const activeRide = await this.prisma.ride.findFirst({
      where: {
        driverId,
        status: { in: [RideStatus.ACCEPTED, RideStatus.ARRIVED, RideStatus.IN_PROGRESS] },
      },
    });
    if (activeRide) {
      this.rideTracking.emitLocation(activeRide.id, { lat, lng });
      return;
    }

    // Same fan-out for a delivery the driver is currently carrying.
    const activeDelivery = await this.prisma.delivery.findFirst({
      where: {
        driverId,
        status: { in: [DeliveryStatus.ACCEPTED, DeliveryStatus.PICKED_UP] },
      },
      select: { id: true },
    });
    if (activeDelivery) {
      this.rideTracking.emitDeliveryLocation(activeDelivery.id, { lat, lng });
    }
  }

  // Last reported position, straight off the GEO set — null once the
  // driver goes offline (setDriverStatus removes them from it).
  async getDriverPosition(driverId: string): Promise<{ lat: number; lng: number } | null> {
    const [pos] = await this.redis.client.geopos(GEO_KEY, driverId);
    return pos ? { lng: Number(pos[0]), lat: Number(pos[1]) } : null;
  }

  // Distance (km) to the nearest online driver who could take each vehicle
  // type — feeds the "arrives in ~4 min" pickup ETA on quotes. One GEO
  // search and one status query regardless of how many vehicle types are
  // asked about. A driver with no vehicleType on file can serve any type,
  // matching findNearbyDrivers below. Absent key = nobody nearby.
  async nearestDriverDistances(
    lat: number,
    lng: number,
    vehicleTypes: string[],
    serviceMode: DriverServiceMode,
  ): Promise<Map<string, number>> {
    const results = (await this.redis.client.geosearch(
      GEO_KEY,
      'FROMLONLAT',
      lng,
      lat,
      'BYRADIUS',
      SEARCH_RADIUS_KM,
      'km',
      'ASC',
      'COUNT',
      50,
      'WITHDIST',
    )) as Array<[string, string]>;
    if (results.length === 0) {
      return new Map();
    }

    const statuses = await this.prisma.driverStatus.findMany({
      where: {
        userId: { in: results.map(([id]) => id) },
        availability: DriverAvailability.ONLINE,
        serviceMode,
      },
      select: { userId: true, vehicleType: true },
    });
    const vehicleOf = new Map(statuses.map((s) => [s.userId, s.vehicleType]));

    const nearest = new Map<string, number>();
    for (const [driverId, dist] of results) {
      if (!vehicleOf.has(driverId)) continue; // offline or in the other service mode
      const driverVehicle = vehicleOf.get(driverId);
      for (const vehicleType of vehicleTypes) {
        if (
          !nearest.has(vehicleType) &&
          (driverVehicle === null || driverVehicle === vehicleType)
        ) {
          nearest.set(vehicleType, Number(dist)); // results are ASC, so first hit is nearest
        }
      }
      if (nearest.size === vehicleTypes.length) break;
    }
    return nearest;
  }

  async startDispatch(rideId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.status !== RideStatus.REQUESTED) {
      return; // already progressed, cancelled, or doesn't exist — nothing to do
    }

    await this.prisma.ride.update({
      where: { id: rideId },
      data: { status: RideStatus.DISPATCHING },
    });

    const maxUnsettledCashRides = await this.getMaxUnsettledCashRides();
    const candidates = await this.findNearbyDrivers(
      ride.pickupLat,
      ride.pickupLng,
      ride.vehicleType,
      MAX_CANDIDATES,
      ride.paymentMethod,
      maxUnsettledCashRides,
    );
    if (candidates.length === 0) {
      await this.resolveNoDrivers(rideId);
      return;
    }

    const expiresAt = new Date(Date.now() + OFFER_TTL_MS);
    await this.prisma.rideOffer.createMany({
      data: candidates.map((driverId) => ({ rideId, driverId, expiresAt })),
    });

    for (const driverId of candidates) {
      this.driverOffers.emitOffer(driverId, {
        rideId,
        pickupAddress: ride.pickupAddress,
        dropoffAddress: ride.dropoffAddress,
        estimatedFare: ride.estimatedFare,
        expiresAt,
      });
    }

    // Single round only for this pass — a full implementation would queue a
    // durable delayed job (BullMQ) per round with retry/backoff instead of
    // a plain in-process timer, which doesn't survive a process restart.
    setTimeout(() => {
      this.expireRoundIfUnresolved(rideId).catch((err) =>
        this.logger.error(`Failed to expire offers for ${rideId}: ${err}`),
      );
    }, OFFER_TTL_MS);
  }

  // The atomic guard on the Ride update below IS the optimistic lock
  // plan.md calls for ("only one driver should win a race on the same
  // offer") — Postgres's own UPDATE...WHERE is already atomic per row, so
  // no separate Redis lock is needed on top of it.
  async acceptOffer(driverId: string, rideId: string) {
    const offer = await this.prisma.rideOffer.findUnique({
      where: { rideId_driverId: { rideId, driverId } },
    });
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }
    if (offer.status !== RideOfferStatus.PENDING || offer.expiresAt < new Date()) {
      throw new ConflictException('This offer is no longer available');
    }

    const ridePreview = await this.prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
    if (ridePreview.paymentMethod === RidePaymentMethod.CASH) {
      const driverStatus = await this.prisma.driverStatus.findUnique({
        where: { userId: driverId },
      });
      const maxUnsettledCashRides = await this.getMaxUnsettledCashRides();
      if ((driverStatus?.unsettledCashRideCount ?? 0) >= maxUnsettledCashRides) {
        throw new ForbiddenException(
          'Outstanding cash-ride commission must be cleared before accepting another cash ride',
        );
      }
    }

    const claimed = await this.prisma.ride.updateMany({
      where: { id: rideId, status: RideStatus.DISPATCHING, driverId: null },
      data: { status: RideStatus.ACCEPTED, driverId, acceptedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.prisma.rideOffer.update({
        where: { id: offer.id },
        data: { status: RideOfferStatus.EXPIRED, respondedAt: new Date() },
      });
      throw new ConflictException('Another driver already accepted this ride');
    }

    await this.prisma.rideOffer.update({
      where: { id: offer.id },
      data: { status: RideOfferStatus.ACCEPTED, respondedAt: new Date() },
    });
    const otherOffers = await this.prisma.rideOffer.findMany({
      where: { rideId, driverId: { not: driverId }, status: RideOfferStatus.PENDING },
    });
    await this.prisma.rideOffer.updateMany({
      where: { rideId, driverId: { not: driverId }, status: RideOfferStatus.PENDING },
      data: { status: RideOfferStatus.EXPIRED, respondedAt: new Date() },
    });
    await this.setDriverStatus(driverId, DriverAvailability.ON_TRIP);

    const [ride, driver] = await Promise.all([
      this.prisma.ride.findUniqueOrThrow({ where: { id: rideId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: driverId } }),
    ]);

    this.rideTracking.emitStatus(rideId, {
      status: 'ACCEPTED',
      driver: {
        id: driver.id,
        firstName: driver.firstName,
        lastName: driver.lastName,
        phone: driver.phone,
      },
    });
    for (const other of otherOffers) {
      this.driverOffers.emitOfferTaken(other.driverId, rideId);
    }
    this.notifications.notify(
      ride.riderId,
      NotificationCategory.TRIPS,
      'Your ride is on the way',
      `${driver.firstName} is on the way to your pickup location.`,
      { rideId },
    );

    return ride;
  }

  async declineOffer(driverId: string, rideId: string) {
    const offer = await this.prisma.rideOffer.findUnique({
      where: { rideId_driverId: { rideId, driverId } },
    });
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }
    if (offer.status !== RideOfferStatus.PENDING) {
      return offer; // already resolved (accepted/expired) — no-op
    }

    const updated = await this.prisma.rideOffer.update({
      where: { id: offer.id },
      data: { status: RideOfferStatus.DECLINED, respondedAt: new Date() },
    });
    await this.resolveNoDriversIfAllResolved(rideId);
    return updated;
  }

  private async findNearbyDrivers(
    lat: number,
    lng: number,
    vehicleType: string,
    limit: number,
    paymentMethod: RidePaymentMethod,
    maxUnsettledCashRides: number,
  ): Promise<string[]> {
    const results = (await this.redis.client.geosearch(
      GEO_KEY,
      'FROMLONLAT',
      lng,
      lat,
      'BYRADIUS',
      SEARCH_RADIUS_KM,
      'km',
      'ASC',
      'COUNT',
      limit * 4, // over-fetch — availability/vehicleType filtering happens after, in Postgres
    )) as string[];

    if (results.length === 0) {
      return [];
    }

    const eligible = await this.prisma.driverStatus.findMany({
      where: {
        userId: { in: results },
        availability: DriverAvailability.ONLINE,
        serviceMode: DriverServiceMode.RIDES,
        OR: [{ vehicleType }, { vehicleType: null }],
        // Capped-out drivers simply never see a cash-ride offer — no point
        // showing them one just to reject it at accept time.
        ...(paymentMethod === RidePaymentMethod.CASH
          ? { unsettledCashRideCount: { lt: maxUnsettledCashRides } }
          : {}),
      },
      select: { userId: true },
    });
    const eligibleIds = new Set(eligible.map((d) => d.userId));
    return results.filter((id) => eligibleIds.has(id)).slice(0, limit);
  }

  private async resolveNoDriversIfAllResolved(rideId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.status !== RideStatus.DISPATCHING) {
      return;
    }
    const pending = await this.prisma.rideOffer.count({
      where: { rideId, status: RideOfferStatus.PENDING },
    });
    if (pending === 0) {
      await this.resolveNoDrivers(rideId);
    }
  }

  private async expireRoundIfUnresolved(rideId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.status !== RideStatus.DISPATCHING) {
      return;
    }
    await this.prisma.rideOffer.updateMany({
      where: { rideId, status: RideOfferStatus.PENDING },
      data: { status: RideOfferStatus.EXPIRED, respondedAt: new Date() },
    });
    await this.resolveNoDrivers(rideId);
  }

  private async resolveNoDrivers(rideId: string) {
    const updated = await this.prisma.ride.updateMany({
      where: { id: rideId, status: { in: [RideStatus.REQUESTED, RideStatus.DISPATCHING] } },
      data: { status: RideStatus.NO_DRIVERS_FOUND },
    });
    if (updated.count > 0) {
      this.rideTracking.emitStatus(rideId, { status: 'NO_DRIVERS_FOUND' });
    }
  }
}
