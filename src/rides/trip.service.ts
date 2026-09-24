import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DriverAvailability, Prisma, RidePaymentMethod, RideStatus } from '@prisma/client';
import { EmailService } from '../integrations/email/email.service';
import { NotificationCategory } from '../notifications/notification-categories';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService, roundMoney } from '../pricing/pricing.service';
import { WalletService } from '../wallet/wallet.service';
import { DispatchService } from './dispatch.service';
import { RideTrackingGateway } from './gateways/ride-tracking.gateway';

const naira = (v: Prisma.Decimal) =>
  `₦${v.toNumber().toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

@Injectable()
export class TripService {
  private readonly logger = new Logger(TripService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly wallet: WalletService,
    private readonly dispatch: DispatchService,
    private readonly rideTracking: RideTrackingGateway,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
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
    this.notifications.notify(
      ride.riderId,
      NotificationCategory.TRIPS,
      'Your driver has arrived',
      'Confirm the plate number, vehicle and driver before getting in.',
      { rideId },
    );
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
    // Commission is the platform's cut of the fare itself — tax is passed
    // through, never commissioned.
    const taxAmount = ride.taxAmount ?? new Prisma.Decimal(0);
    const commissionRule = await this.pricing.getActiveCommissionRate('RIDE', ride.vehicleType);
    const commissionAmount = roundMoney(finalFare.minus(taxAmount).mul(commissionRule.rate));

    let transactionId: string | undefined;
    const reference = `ride:${rideId}`;
    if (ride.paymentMethod === RidePaymentMethod.WALLET) {
      const tx = await this.wallet.payForRide(
        ride.riderId,
        driverId,
        finalFare,
        commissionAmount,
        reference,
        undefined,
        taxAmount,
      );
      transactionId = tx.id;
    } else {
      // The driver collected the tax in cash along with the fare, so it is
      // added to what they owe. Known gap: settleCommission recognises the
      // whole settled amount as PLATFORM_REVENUE, so cash-trip tax is not
      // yet split out to PLATFORM_TAX_PAYABLE at settlement.
      await this.wallet.recordCashRideCommission(
        driverId,
        commissionAmount.plus(taxAmount),
        `${reference}:commission`,
        taxAmount.greaterThan(0)
          ? { commission: commissionAmount.toString(), tax: taxAmount.toString() }
          : undefined,
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

    this.notifications.notify(
      ride.riderId,
      NotificationCategory.TRIPS,
      ride.paymentMethod === RidePaymentMethod.WALLET ? 'Payment successful' : 'Trip completed',
      ride.paymentMethod === RidePaymentMethod.WALLET
        ? `${naira(finalFare)} was paid for your ride to ${ride.dropoffAddress.split(',')[0]}.`
        : `You've arrived at ${ride.dropoffAddress.split(',')[0]}. Pay ${naira(finalFare)} in cash.`,
      { rideId },
    );

    // Best-effort — a mail provider hiccup must never fail trip completion.
    this.emailReceipt(completed.id).catch((err) =>
      this.logger.warn(`Failed to email receipt for ride ${rideId}: ${err}`),
    );
    this.rideTracking.emitStatus(rideId, { status: 'COMPLETED', finalFare: finalFare.toString() });

    return completed;
  }

  // "Receipt emailed" on the trip-completed screen — only to a verified
  // address, so a typo'd email never receives someone's trip details.
  private async emailReceipt(rideId: string) {
    const ride = await this.prisma.ride.findUniqueOrThrow({
      where: { id: rideId },
      include: { rider: true },
    });
    if (!ride.rider.email || !ride.rider.emailVerifiedAt || !ride.finalFare) {
      return;
    }

    const naira = (v: Prisma.Decimal) =>
      `₦${v.toNumber().toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const lines = [
      ...(ride.subtotalFare ? [{ label: 'Fare', value: naira(ride.subtotalFare) }] : []),
      ...(ride.promoDiscount?.greaterThan(0)
        ? [{ label: 'Promo discount', value: `-${naira(ride.promoDiscount)}` }]
        : []),
      ...(ride.taxAmount?.greaterThan(0) ? [{ label: 'Tax', value: naira(ride.taxAmount) }] : []),
      { label: 'Distance', value: `${ride.distanceKm ?? 0} km` },
      { label: 'Payment method', value: ride.paymentMethod === 'CASH' ? 'Cash' : 'Wallet' },
      { label: 'Total paid', value: naira(ride.finalFare), emphasis: true },
    ];

    await this.email.sendTripReceipt(ride.rider.email, {
      riderFirstName: ride.rider.firstName,
      reference: ride.publicId,
      pickupAddress: ride.pickupAddress,
      dropoffAddress: ride.dropoffAddress,
      completedAt: (ride.completedAt ?? new Date()).toLocaleString('en-NG', {
        timeZone: 'Africa/Lagos',
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
      lines,
    });
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
      publicId: ride.publicId,
      rider: `${ride.rider.firstName} ${ride.rider.lastName}`,
      driver: ride.driver ? `${ride.driver.firstName} ${ride.driver.lastName}` : null,
      pickupAddress: ride.pickupAddress,
      dropoffAddress: ride.dropoffAddress,
      distanceKm: ride.distanceKm,
      durationMinutes: ride.durationMinutes,
      fare: ride.finalFare,
      subtotalFare: ride.subtotalFare,
      promoDiscount: ride.promoDiscount,
      taxAmount: ride.taxAmount,
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
