import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DriverServiceMode,
  Prisma,
  PromoApplicableService,
  RidePaymentMethod,
  RideStatus,
  TariffServiceType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleMapsService } from '../integrations/google-maps/google-maps.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { PricingService } from '../pricing/pricing.service';
import { QuoteService } from '../pricing/quote.service';
import { PromoService } from '../promo/promo.service';
import { ServiceAreasService } from '../service-areas/service-areas.service';
import { DriverProfilesService } from '../drivers/driver-profiles.service';
import { DispatchService } from './dispatch.service';
import { approximateRoadDistance } from '../common/utils/haversine.util';
import { generateSecureToken } from '../common/utils/token.util';
import { trackingUrl } from '../common/utils/tracking-url.util';

// Average city speed used to turn "nearest driver is 1.2 km away" into a
// pickup ETA. Tunable via PlatformConfig without a deploy.
const PICKUP_SPEED_CONFIG_KEY = 'pickupEtaSpeedKmh';
const DEFAULT_PICKUP_SPEED_KMH = 20;

// Rides a driver is attached to and moving on — the only states where the
// rider (or someone they shared the trip with) sees a live position.
const LIVE_RIDE_STATUSES: RideStatus[] = [
  RideStatus.ACCEPTED,
  RideStatus.ARRIVED,
  RideStatus.IN_PROGRESS,
];
const ENDED_RIDE_STATUSES: RideStatus[] = [
  RideStatus.COMPLETED,
  RideStatus.CANCELLED,
  RideStatus.NO_DRIVERS_FOUND,
];

@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly maps: GoogleMapsService,
    private readonly pricing: PricingService,
    private readonly quotes: QuoteService,
    private readonly serviceAreas: ServiceAreasService,
    private readonly dispatch: DispatchService,
    private readonly promo: PromoService,
    private readonly driverProfiles: DriverProfilesService,
    private readonly platformConfig: PlatformConfigService,
    private readonly config: ConfigService,
  ) {}

  // Every ride option for the route (or just `vehicleType` when given),
  // each with its own price breakdown, trip time and pickup ETA. A promo
  // code is only applied for a signed-in caller, since usage limits are
  // per user.
  async estimateFare(
    params: {
      pickupLat: number;
      pickupLng: number;
      dropoffLat: number;
      dropoffLng: number;
      vehicleType?: string;
      promoCode?: string;
    },
    userId?: string,
  ) {
    const distance = await this.getDistance(
      params.pickupLat,
      params.pickupLng,
      params.dropoffLat,
      params.dropoffLng,
    );
    const areaCheck = await this.serviceAreas.validateLocation(params.pickupLat, params.pickupLng);

    const { quotes, promo } = await this.quotes.quoteVehicles({
      serviceType: TariffServiceType.RIDE,
      serviceAreaId: areaCheck.serviceArea?.id,
      distanceKm: distance.distanceKm,
      durationMinutes: distance.durationMinutes,
      vehicleType: params.vehicleType,
      promo:
        params.promoCode && userId
          ? { code: params.promoCode, userId, service: PromoApplicableService.RIDE }
          : undefined,
    });

    const [nearest, speedKmh] = await Promise.all([
      this.dispatch.nearestDriverDistances(
        params.pickupLat,
        params.pickupLng,
        quotes.map((q) => q.vehicleType),
        DriverServiceMode.RIDES,
      ),
      this.platformConfig.get<number>(PICKUP_SPEED_CONFIG_KEY, DEFAULT_PICKUP_SPEED_KMH),
    ]);

    const options = quotes.map((q) => {
      const km = nearest.get(q.vehicleType);
      return {
        ...q,
        // null = no available driver nearby right now for this option.
        pickupEtaMinutes: km === undefined ? null : Math.max(1, Math.ceil((km / speedKmh) * 60)),
      };
    });

    return {
      isServiceable: areaCheck.isServiceable,
      distanceKm: distance.distanceKm,
      durationMinutes: distance.durationMinutes,
      currency: options[0]?.currency ?? 'NGN',
      options,
      promo:
        params.promoCode && !userId
          ? {
              code: params.promoCode.toUpperCase(),
              applied: false,
              message: 'Sign in to apply a promo code',
            }
          : promo,
      // Back-compat for callers that asked for a single vehicle type.
      ...(params.vehicleType ? { estimatedFare: options[0]?.total } : {}),
    };
  }

  async createRide(
    riderId: string,
    dto: {
      pickupLat: number;
      pickupLng: number;
      pickupAddress: string;
      dropoffLat: number;
      dropoffLng: number;
      dropoffAddress: string;
      vehicleType: string;
      paymentMethod?: RidePaymentMethod;
      promoCode?: string;
    },
  ) {
    if (dto.paymentMethod === RidePaymentMethod.BUSINESS_INVOICE) {
      throw new BadRequestException('Business invoice payment is only available for deliveries');
    }

    const areaCheck = await this.serviceAreas.validateLocation(dto.pickupLat, dto.pickupLng);
    if (!areaCheck.isServiceable || !areaCheck.serviceArea) {
      throw new BadRequestException('Pickup location is outside our service area');
    }

    const distance = await this.getDistance(
      dto.pickupLat,
      dto.pickupLng,
      dto.dropoffLat,
      dto.dropoffLng,
    );
    const tariff = await this.pricing.getActiveTariff(
      dto.vehicleType,
      areaCheck.serviceArea.id,
      TariffServiceType.RIDE,
    );
    const subtotal = this.pricing.calculateFare(
      tariff,
      distance.distanceKm,
      distance.durationMinutes,
    );

    // Applied here, before the ride is ever created — TripService later
    // just uses `estimatedFare` as `finalFare` with no promo-awareness of
    // its own. Unlike the quote, an invalid code fails the booking: the
    // rider explicitly asked for it.
    let promoId: string | undefined;
    let discount = new Prisma.Decimal(0);
    if (dto.promoCode) {
      const result = await this.promo.validate(
        dto.promoCode,
        PromoApplicableService.RIDE,
        subtotal,
        riderId,
      );
      promoId = result.promoId;
      discount = result.discountAmount;
    }
    const fare = await this.pricing.buildFareBreakdown(subtotal, discount);

    const ride = await this.prisma.ride.create({
      data: {
        riderId,
        vehicleType: dto.vehicleType,
        paymentMethod: dto.paymentMethod,
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        pickupAddress: dto.pickupAddress,
        dropoffLat: dto.dropoffLat,
        dropoffLng: dto.dropoffLng,
        dropoffAddress: dto.dropoffAddress,
        serviceAreaId: areaCheck.serviceArea.id,
        distanceKm: distance.distanceKm,
        durationMinutes: distance.durationMinutes,
        subtotalFare: fare.subtotal,
        promoDiscount: fare.promoDiscount,
        taxAmount: fare.tax,
        estimatedFare: fare.total,
        status: RideStatus.REQUESTED,
      },
    });

    if (promoId) {
      await this.promo.recordRedemption(
        promoId,
        riderId,
        PromoApplicableService.RIDE,
        ride.id,
        fare.promoDiscount,
      );
    }

    // Not awaited — booking creation shouldn't block on driver matching,
    // which can take several rounds of offers with their own TTLs. The
    // rider gets live progress over the ride:tracking WS instead.
    this.dispatch.startDispatch(ride.id).catch((err) => {
      this.logger.error(`Dispatch failed to start for ride ${ride.id}: ${err}`);
    });

    return ride;
  }

  // The trip screen's data: the ride, the driver card (photo, rating,
  // vehicle, phone for "Call driver") and, while the trip is live, the
  // driver's last position. Live updates keep arriving over the /rides WS.
  async getRide(userId: string, rideId: string) {
    const ride = await this.findRideForParticipant(userId, rideId);
    const [driver, driverPosition, rating] = await Promise.all([
      ride.driverId ? this.driverProfiles.getDriverCard(ride.driverId) : null,
      ride.driverId && LIVE_RIDE_STATUSES.includes(ride.status)
        ? this.dispatch.getDriverPosition(ride.driverId)
        : null,
      this.prisma.rideRating.findUnique({ where: { rideId } }),
    ]);
    return { ...ride, driver, driverPosition, rating };
  }

  async listRides(userId: string, role: 'RIDER' | 'DRIVER', take = 50, skip = 0) {
    const where: Prisma.RideWhereInput =
      role === 'RIDER' ? { riderId: userId } : { driverId: userId };
    return this.prisma.ride.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip });
  }

  async rateRide(riderId: string, rideId: string, rating: number, comment?: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    if (ride.riderId !== riderId) {
      throw new ForbiddenException('Only the rider on this ride can rate it');
    }
    if (ride.status !== RideStatus.COMPLETED) {
      throw new BadRequestException('Only completed rides can be rated');
    }

    return this.prisma.rideRating.upsert({
      where: { rideId },
      update: { rating, comment },
      create: { rideId, rating, comment },
    });
  }

  // Reviews this rider has left, newest first, for the Profile → Reviews
  // screen. Editing one goes through POST /rides/{id}/rate (an upsert).
  async listMyReviews(riderId: string, take = 50, skip = 0) {
    const ratings = await this.prisma.rideRating.findMany({
      where: { ride: { riderId } },
      include: {
        ride: {
          select: {
            id: true,
            publicId: true,
            driverId: true,
            dropoffAddress: true,
            completedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
    const cards = await this.driverProfiles.getDriverCards(
      ratings.map((r) => r.ride.driverId).filter((id): id is string => !!id),
    );

    return ratings.map((r) => {
      const card = r.ride.driverId ? cards.get(r.ride.driverId) : undefined;
      return {
        rideId: r.ride.id,
        ridePublicId: r.ride.publicId,
        dropoffAddress: r.ride.dropoffAddress,
        completedAt: r.ride.completedAt,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
        // No phone — this is a past trip, not an active one.
        driver: card
          ? {
              id: card.id,
              firstName: card.firstName,
              lastName: card.lastName,
              profilePhotoUrl: card.profilePhotoUrl,
              vehicle: card.vehicle,
            }
          : null,
      };
    });
  }

  // "Share ride": mints (once) an unguessable token for a public live view.
  async shareRide(riderId: string, rideId: string) {
    const ride = await this.findRideForParticipant(riderId, rideId);
    if (ride.riderId !== riderId) {
      throw new ForbiddenException('Only the rider can share this ride');
    }
    if (ENDED_RIDE_STATUSES.includes(ride.status)) {
      throw new BadRequestException('This ride has ended and can no longer be shared');
    }

    const shareToken =
      ride.shareToken ??
      (
        await this.prisma.ride.update({
          where: { id: rideId },
          data: { shareToken: generateSecureToken(16) },
        })
      ).shareToken!;
    return { shareToken, url: trackingUrl(this.config, `ride/${shareToken}`) };
  }

  // Public — the share token is the credential. Shows what someone
  // watching over the rider needs (where they are, who's driving, which
  // car) and nothing about payment or the rider's account. The position
  // stops as soon as the ride ends.
  async getSharedRide(shareToken: string) {
    const ride = await this.prisma.ride.findUnique({ where: { shareToken } });
    if (!ride) {
      throw new NotFoundException('Tracking link not found');
    }
    const live = LIVE_RIDE_STATUSES.includes(ride.status);
    const card =
      ride.driverId && !ENDED_RIDE_STATUSES.includes(ride.status)
        ? await this.driverProfiles.getDriverCard(ride.driverId)
        : null;

    return {
      status: ride.status,
      pickupAddress: ride.pickupAddress,
      dropoffAddress: ride.dropoffAddress,
      driver: card
        ? {
            firstName: card.firstName,
            profilePhotoUrl: card.profilePhotoUrl,
            vehicle: card.vehicle,
          }
        : null,
      driverPosition:
        live && ride.driverId ? await this.dispatch.getDriverPosition(ride.driverId) : null,
      requestedAt: ride.requestedAt,
      startedAt: ride.startedAt,
      completedAt: ride.completedAt,
    };
  }

  async findRideForParticipant(userId: string, rideId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    if (ride.riderId !== userId && ride.driverId !== userId) {
      throw new ForbiddenException('You are not a participant on this ride');
    }
    return ride;
  }

  private async getDistance(
    pickupLat: number,
    pickupLng: number,
    dropoffLat: number,
    dropoffLng: number,
  ) {
    if (this.maps.isConfigured) {
      try {
        return await this.maps.distanceMatrix(pickupLat, pickupLng, dropoffLat, dropoffLng);
      } catch (err) {
        this.logger.warn(
          `Distance Matrix call failed, falling back to approximate distance: ${err}`,
        );
      }
    }
    return approximateRoadDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);
  }
}
