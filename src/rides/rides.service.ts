import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PromoApplicableService, RideStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleMapsService } from '../integrations/google-maps/google-maps.service';
import { PricingService } from '../pricing/pricing.service';
import { PromoService } from '../promo/promo.service';
import { ServiceAreasService } from '../service-areas/service-areas.service';
import { DispatchService } from './dispatch.service';
import { approximateRoadDistance } from '../common/utils/haversine.util';

@Injectable()
export class RidesService {
  private readonly logger = new Logger(RidesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly maps: GoogleMapsService,
    private readonly pricing: PricingService,
    private readonly serviceAreas: ServiceAreasService,
    private readonly dispatch: DispatchService,
    private readonly promo: PromoService,
  ) {}

  async estimateFare(params: {
    pickupLat: number;
    pickupLng: number;
    dropoffLat: number;
    dropoffLng: number;
    vehicleType: string;
  }) {
    const distance = await this.getDistance(
      params.pickupLat,
      params.pickupLng,
      params.dropoffLat,
      params.dropoffLng,
    );
    const areaCheck = await this.serviceAreas.validateLocation(params.pickupLat, params.pickupLng);
    const tariff = await this.pricing.getActiveTariff(
      params.vehicleType,
      areaCheck.serviceArea?.id,
    );
    const estimatedFare = this.pricing.calculateFare(
      tariff,
      distance.distanceKm,
      distance.durationMinutes,
    );

    return {
      isServiceable: areaCheck.isServiceable,
      distanceKm: distance.distanceKm,
      durationMinutes: distance.durationMinutes,
      estimatedFare,
      currency: tariff.currency,
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
      paymentMethod?: 'WALLET' | 'CASH';
      promoCode?: string;
    },
  ) {
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
    const tariff = await this.pricing.getActiveTariff(dto.vehicleType, areaCheck.serviceArea.id);
    let estimatedFare = this.pricing.calculateFare(
      tariff,
      distance.distanceKm,
      distance.durationMinutes,
    );

    // Applied here, before the ride is ever created — TripService later
    // just uses `estimatedFare` as `finalFare` with no promo-awareness of
    // its own, same as it already does with no promo at all.
    let appliedPromo: { promoId: string; discountAmount: Prisma.Decimal } | undefined;
    if (dto.promoCode) {
      const result = await this.promo.validate(
        dto.promoCode,
        PromoApplicableService.RIDE,
        estimatedFare,
        riderId,
      );
      appliedPromo = { promoId: result.promoId, discountAmount: result.discountAmount };
      estimatedFare = result.finalAmount;
    }

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
        estimatedFare,
        status: RideStatus.REQUESTED,
      },
    });

    if (appliedPromo) {
      await this.promo.recordRedemption(
        appliedPromo.promoId,
        riderId,
        PromoApplicableService.RIDE,
        ride.id,
        appliedPromo.discountAmount,
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

  async getRide(userId: string, rideId: string) {
    const ride = await this.findRideForParticipant(userId, rideId);
    return ride;
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
