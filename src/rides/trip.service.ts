import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DriverAvailability, RidePaymentMethod, RideStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { WalletService } from '../wallet/wallet.service';
import { DispatchService } from './dispatch.service';
import { RideTrackingGateway } from './gateways/ride-tracking.gateway';

@Injectable()
export class TripService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly wallet: WalletService,
    private readonly dispatch: DispatchService,
    private readonly rideTracking: RideTrackingGateway,
  ) {}

  async markArrived(driverId: string, rideId: string) {
    const ride = await this.transitionAsDriver(
      driverId,
      rideId,
      RideStatus.ACCEPTED,
      RideStatus.ARRIVED,
      {
        arrivedAt: new Date(),
      },
    );
    this.rideTracking.emitStatus(rideId, { status: 'ARRIVED' });
    return ride;
  }

  async startTrip(driverId: string, rideId: string) {
    const ride = await this.transitionAsDriver(
      driverId,
      rideId,
      RideStatus.ARRIVED,
      RideStatus.IN_PROGRESS,
      {
        startedAt: new Date(),
      },
    );
    this.rideTracking.emitStatus(rideId, { status: 'IN_PROGRESS' });
    return ride;
  }

  async completeTrip(driverId: string, rideId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    if (ride.driverId !== driverId) {
      throw new ForbiddenException('You are not the driver on this ride');
    }
    if (ride.status !== RideStatus.IN_PROGRESS) {
      throw new BadRequestException(`Cannot complete a ride in status ${ride.status}`);
    }

    // MVP simplification: final fare is the original estimate, not
    // recomputed from the actual GPS trace — a real implementation would
    // re-run the tariff formula against actual distance/duration travelled.
    const finalFare = ride.estimatedFare!;
    const commissionRule = await this.pricing.getActiveCommissionRate('RIDE', ride.vehicleType);
    const commissionAmount = finalFare.mul(commissionRule.rate);

    let transactionId: string | undefined;
    const reference = `ride:${rideId}`;
    if (ride.paymentMethod === RidePaymentMethod.WALLET) {
      const tx = await this.wallet.payForRide(
        ride.riderId,
        driverId,
        finalFare,
        commissionAmount,
        reference,
      );
      transactionId = tx.id;
    } else {
      await this.wallet.recordCashRideCommission(
        driverId,
        commissionAmount,
        `${reference}:commission`,
      );
    }

    const completed = await this.prisma.ride.update({
      where: { id: rideId },
      data: {
        status: RideStatus.COMPLETED,
        finalFare,
        commissionAmount,
        completedAt: new Date(),
        transactionId,
      },
    });

    // Back on the market for new offers.
    await this.dispatch.setDriverStatus(driverId, DriverAvailability.ONLINE);
    this.rideTracking.emitStatus(rideId, { status: 'COMPLETED', finalFare: finalFare.toString() });

    return completed;
  }

  async getReceipt(userId: string, rideId: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      include: { rider: true, driver: true },
    });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    if (ride.riderId !== userId && ride.driverId !== userId) {
      throw new ForbiddenException('You are not a participant on this ride');
    }
    if (ride.status !== RideStatus.COMPLETED) {
      throw new BadRequestException('Receipt is only available for completed rides');
    }

    return {
      rideId: ride.id,
      rider: `${ride.rider.firstName} ${ride.rider.lastName}`,
      driver: ride.driver ? `${ride.driver.firstName} ${ride.driver.lastName}` : null,
      pickupAddress: ride.pickupAddress,
      dropoffAddress: ride.dropoffAddress,
      distanceKm: ride.distanceKm,
      durationMinutes: ride.durationMinutes,
      fare: ride.finalFare,
      commission: ride.commissionAmount,
      paymentMethod: ride.paymentMethod,
      completedAt: ride.completedAt,
    };
  }

  private async transitionAsDriver(
    driverId: string,
    rideId: string,
    fromStatus: RideStatus,
    toStatus: RideStatus,
    extraData: Record<string, unknown>,
  ) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    if (ride.driverId !== driverId) {
      throw new ForbiddenException('You are not the driver on this ride');
    }
    if (ride.status !== fromStatus) {
      throw new BadRequestException(`Cannot move to ${toStatus} from status ${ride.status}`);
    }

    return this.prisma.ride.update({
      where: { id: rideId },
      data: { status: toStatus, ...extraData },
    });
  }
}
