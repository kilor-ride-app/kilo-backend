import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryOfferStatus,
  DeliveryStatus,
  DriverAvailability,
  DriverServiceMode,
  RidePaymentMethod,
} from '@prisma/client';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { DriverOffersGateway } from '../rides/gateways/driver-offers.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// Same Redis GEO key DispatchService (rides) GEOADDs into — one physical
// driver pool shared across both lines of work, filtered here by
// DriverStatus.serviceMode instead of a separate location structure.
const GEO_KEY = 'drivers:geo';
const SEARCH_RADIUS_KM = 8; // wider than rides' 5km — delivery jobs tolerate a longer driver approach
const OFFER_TTL_MS = 20_000; // longer than rides' 15s — a delivery offer carries more info to read (multi-stop, package)
const MAX_CANDIDATES = 5;
const DEFAULT_MAX_UNSETTLED_CASH_RIDES = 3;
const MAX_UNSETTLED_CASH_RIDES_CONFIG_KEY = 'maxUnsettledCashRides';

@Injectable()
export class LogisticsDispatchService {
  private readonly logger = new Logger(LogisticsDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly driverOffers: DriverOffersGateway,
    private readonly platformConfig: PlatformConfigService,
  ) {}

  // Same config key + default DispatchService (rides) reads — the cap is
  // shared across both lines of work (see DriverStatus schema comment).
  private getMaxUnsettledCashRides(): Promise<number> {
    return this.platformConfig.get(
      MAX_UNSETTLED_CASH_RIDES_CONFIG_KEY,
      DEFAULT_MAX_UNSETTLED_CASH_RIDES,
    );
  }

  async startDispatch(deliveryId: string) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery || delivery.status !== DeliveryStatus.REQUESTED) {
      return;
    }

    await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { status: DeliveryStatus.DISPATCHING },
    });

    const maxUnsettledCashRides = await this.getMaxUnsettledCashRides();
    const candidates = await this.findNearbyDrivers(
      delivery.pickupLat,
      delivery.pickupLng,
      delivery.vehicleType,
      MAX_CANDIDATES,
      delivery.paymentMethod,
      maxUnsettledCashRides,
    );
    if (candidates.length === 0) {
      await this.resolveNoDrivers(deliveryId);
      return;
    }

    const expiresAt = new Date(Date.now() + OFFER_TTL_MS);
    await this.prisma.deliveryOffer.createMany({
      data: candidates.map((driverId) => ({ deliveryId, driverId, expiresAt })),
    });

    for (const driverId of candidates) {
      this.driverOffers.emitDeliveryOffer(driverId, {
        deliveryId,
        pickupAddress: delivery.pickupAddress,
        packageDescription: delivery.packageDescription,
        estimatedFare: delivery.estimatedFare,
        expiresAt,
      });
    }

    setTimeout(() => {
      this.expireRoundIfUnresolved(deliveryId).catch((err) =>
        this.logger.error(`Failed to expire offers for delivery ${deliveryId}: ${err}`),
      );
    }, OFFER_TTL_MS);
  }

  async acceptOffer(driverId: string, deliveryId: string) {
    const offer = await this.prisma.deliveryOffer.findUnique({
      where: { deliveryId_driverId: { deliveryId, driverId } },
    });
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }
    if (offer.status !== DeliveryOfferStatus.PENDING || offer.expiresAt < new Date()) {
      throw new ConflictException('This offer is no longer available');
    }

    const deliveryPreview = await this.prisma.delivery.findUniqueOrThrow({
      where: { id: deliveryId },
    });
    if (deliveryPreview.paymentMethod === RidePaymentMethod.CASH) {
      const driverStatus = await this.prisma.driverStatus.findUnique({
        where: { userId: driverId },
      });
      const maxUnsettledCashRides = await this.getMaxUnsettledCashRides();
      if ((driverStatus?.unsettledCashRideCount ?? 0) >= maxUnsettledCashRides) {
        throw new ForbiddenException(
          'Outstanding cash-ride commission must be cleared before accepting another cash delivery',
        );
      }
    }

    const claimed = await this.prisma.delivery.updateMany({
      where: { id: deliveryId, status: DeliveryStatus.DISPATCHING, driverId: null },
      data: { status: DeliveryStatus.ACCEPTED, driverId, acceptedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.prisma.deliveryOffer.update({
        where: { id: offer.id },
        data: { status: DeliveryOfferStatus.EXPIRED, respondedAt: new Date() },
      });
      throw new ConflictException('Another driver already accepted this delivery');
    }

    await this.prisma.deliveryOffer.update({
      where: { id: offer.id },
      data: { status: DeliveryOfferStatus.ACCEPTED, respondedAt: new Date() },
    });
    const otherOffers = await this.prisma.deliveryOffer.findMany({
      where: { deliveryId, driverId: { not: driverId }, status: DeliveryOfferStatus.PENDING },
    });
    await this.prisma.deliveryOffer.updateMany({
      where: { deliveryId, driverId: { not: driverId }, status: DeliveryOfferStatus.PENDING },
      data: { status: DeliveryOfferStatus.EXPIRED, respondedAt: new Date() },
    });
    await this.prisma.driverStatus.update({
      where: { userId: driverId },
      data: { availability: DriverAvailability.ON_TRIP },
    });

    for (const other of otherOffers) {
      this.driverOffers.emitDeliveryOfferTaken(other.driverId, deliveryId);
    }

    return this.prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
  }

  async declineOffer(driverId: string, deliveryId: string) {
    const offer = await this.prisma.deliveryOffer.findUnique({
      where: { deliveryId_driverId: { deliveryId, driverId } },
    });
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }
    if (offer.status !== DeliveryOfferStatus.PENDING) {
      return offer;
    }

    const updated = await this.prisma.deliveryOffer.update({
      where: { id: offer.id },
      data: { status: DeliveryOfferStatus.DECLINED, respondedAt: new Date() },
    });
    await this.resolveNoDriversIfAllResolved(deliveryId);
    return updated;
  }

  // Voids every pending offer on a delivery — used when a sender/admin
  // cancels one that's still mid-dispatch.
  async voidPendingOffers(deliveryId: string) {
    const pending = await this.prisma.deliveryOffer.findMany({
      where: { deliveryId, status: DeliveryOfferStatus.PENDING },
    });
    await this.prisma.deliveryOffer.updateMany({
      where: { deliveryId, status: DeliveryOfferStatus.PENDING },
      data: { status: DeliveryOfferStatus.EXPIRED, respondedAt: new Date() },
    });
    for (const offer of pending) {
      this.driverOffers.emitDeliveryOfferCancelled(offer.driverId, deliveryId);
    }
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
      limit * 4,
    )) as string[];

    if (results.length === 0) {
      return [];
    }

    const eligible = await this.prisma.driverStatus.findMany({
      where: {
        userId: { in: results },
        availability: DriverAvailability.ONLINE,
        serviceMode: DriverServiceMode.LOGISTICS,
        OR: [{ vehicleType }, { vehicleType: null }],
        // Capped-out drivers simply never see a cash-delivery offer — same
        // rationale as DispatchService (rides), and the same shared counter.
        ...(paymentMethod === RidePaymentMethod.CASH
          ? { unsettledCashRideCount: { lt: maxUnsettledCashRides } }
          : {}),
      },
      select: { userId: true },
    });
    const eligibleIds = new Set(eligible.map((d) => d.userId));
    return results.filter((id) => eligibleIds.has(id)).slice(0, limit);
  }

  private async resolveNoDriversIfAllResolved(deliveryId: string) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery || delivery.status !== DeliveryStatus.DISPATCHING) {
      return;
    }
    const pending = await this.prisma.deliveryOffer.count({
      where: { deliveryId, status: DeliveryOfferStatus.PENDING },
    });
    if (pending === 0) {
      await this.resolveNoDrivers(deliveryId);
    }
  }

  private async expireRoundIfUnresolved(deliveryId: string) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery || delivery.status !== DeliveryStatus.DISPATCHING) {
      return;
    }
    await this.prisma.deliveryOffer.updateMany({
      where: { deliveryId, status: DeliveryOfferStatus.PENDING },
      data: { status: DeliveryOfferStatus.EXPIRED, respondedAt: new Date() },
    });
    await this.resolveNoDrivers(deliveryId);
  }

  private async resolveNoDrivers(deliveryId: string) {
    await this.prisma.delivery.updateMany({
      where: {
        id: deliveryId,
        status: { in: [DeliveryStatus.REQUESTED, DeliveryStatus.DISPATCHING] },
      },
      data: { status: DeliveryStatus.NO_DRIVERS_FOUND },
    });
  }
}
