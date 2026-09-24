import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DriverAvailability, RideOfferStatus, RideStatus, TariffServiceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { WalletService } from '../wallet/wallet.service';
import { DispatchService } from './dispatch.service';
import { DriverOffersGateway } from './gateways/driver-offers.gateway';
import { RideTrackingGateway } from './gateways/ride-tracking.gateway';

// Cancellation is free before a driver has committed to the ride
// (REQUESTED/DISPATCHING/NO_DRIVERS_FOUND); once a driver has ACCEPTED or
// ARRIVED, a rider-initiated cancellation charges the tariff's
// cancellationFee — split via the same fare/commission path as a normal
// ride payment, since it's compensating the driver's dead mileage the same
// way a fare does. Driver-initiated cancellations never charge the rider.
@Injectable()
export class CancellationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly wallet: WalletService,
    private readonly dispatch: DispatchService,
    private readonly driverOffers: DriverOffersGateway,
    private readonly rideTracking: RideTrackingGateway,
  ) {}

  async cancel(userId: string, rideId: string, reason?: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    if (ride.riderId !== userId && ride.driverId !== userId) {
      throw new ForbiddenException('You are not a participant on this ride');
    }
    const cancellableStatuses: RideStatus[] = [
      RideStatus.REQUESTED,
      RideStatus.DISPATCHING,
      RideStatus.NO_DRIVERS_FOUND,
      RideStatus.ACCEPTED,
      RideStatus.ARRIVED,
    ];
    if (!cancellableStatuses.includes(ride.status)) {
      throw new BadRequestException(`Cannot cancel a ride in status ${ride.status}`);
    }

    const driverCommittedStatuses: RideStatus[] = [RideStatus.ACCEPTED, RideStatus.ARRIVED];
    const driverCommitted = driverCommittedStatuses.includes(ride.status);
    const isRider = userId === ride.riderId;
    let cancellationFee = 0;

    if (driverCommitted && isRider && ride.driverId) {
      const tariff = await this.pricing.getActiveTariff(
        ride.vehicleType,
        ride.serviceAreaId ?? undefined,
        TariffServiceType.RIDE,
      );
      const commissionRule = await this.pricing.getActiveCommissionRate('RIDE', ride.vehicleType);
      const commissionAmount = tariff.cancellationFee.mul(commissionRule.rate);
      await this.wallet.payForRide(
        ride.riderId,
        ride.driverId,
        tariff.cancellationFee,
        commissionAmount,
        `ride:${rideId}:cancellation`,
      );
      cancellationFee = tariff.cancellationFee.toNumber();
    }

    // Still dispatching — void any outstanding offers so drivers stop
    // seeing a ride that no longer exists.
    if (ride.status === RideStatus.DISPATCHING) {
      const pendingOffers = await this.prisma.rideOffer.findMany({
        where: { rideId, status: RideOfferStatus.PENDING },
      });
      await this.prisma.rideOffer.updateMany({
        where: { rideId, status: RideOfferStatus.PENDING },
        data: { status: RideOfferStatus.EXPIRED, respondedAt: new Date() },
      });
      for (const offer of pendingOffers) {
        this.driverOffers.emitOfferCancelled(offer.driverId, rideId);
      }
    }

    if (ride.driverId) {
      await this.dispatch.setDriverStatus(ride.driverId, DriverAvailability.ONLINE);
    }

    const cancelled = await this.prisma.ride.update({
      where: { id: rideId },
      data: {
        status: RideStatus.CANCELLED,
        cancelledById: userId,
        cancellationReason: reason,
        cancellationFee,
        cancelledAt: new Date(),
      },
    });

    this.rideTracking.emitStatus(rideId, { status: 'CANCELLED', cancelledBy: userId });
    return cancelled;
  }

  async listCancellations(take = 50, skip = 0) {
    return this.prisma.ride.findMany({
      where: { status: RideStatus.CANCELLED },
      orderBy: { cancelledAt: 'desc' },
      take,
      skip,
    });
  }
}
