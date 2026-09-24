import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryStatus,
  DriverAvailability,
  Prisma,
  ProofOfDeliveryType,
  RidePaymentMethod,
} from '@prisma/client';
import { hashToken } from '../common/utils/token.util';
import { R2Service } from '../integrations/r2/r2.service';
import { PricingService, roundMoney } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';
import { RideTrackingGateway } from '../rides/gateways/ride-tracking.gateway';
import { NotificationCategory } from '../notifications/notification-categories';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletService } from '../wallet/wallet.service';

const INVOICE_DUE_MS = 14 * 24 * 60 * 60 * 1000; // net-14

@Injectable()
export class LogisticsTripService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly wallet: WalletService,
    private readonly r2: R2Service,
    private readonly tracking: RideTrackingGateway,
    private readonly notifications: NotificationsService,
  ) {}

  // Driver reached the pickup point — a timeline milestone only; the
  // status stays ACCEPTED until the package is actually collected.
  async markArrivedAtPickup(driverId: string, deliveryId: string) {
    return this.recordMilestone(driverId, deliveryId, DeliveryStatus.ACCEPTED, 'arrivedAtPickupAt');
  }

  async confirmPickup(driverId: string, deliveryId: string) {
    const delivery = await this.transitionAsDriver(
      driverId,
      deliveryId,
      DeliveryStatus.ACCEPTED,
      DeliveryStatus.PICKED_UP,
      { pickedUpAt: new Date() },
    );
    this.tracking.emitDeliveryStatus(deliveryId, { status: DeliveryStatus.PICKED_UP });
    return delivery;
  }

  // Driver reached the drop-off ("Arrived" on the sender's timeline).
  async markArrivedAtDropoff(driverId: string, deliveryId: string) {
    return this.recordMilestone(
      driverId,
      deliveryId,
      DeliveryStatus.PICKED_UP,
      'arrivedAtDropoffAt',
    );
  }

  async submitProofOfDelivery(
    driverId: string,
    deliveryId: string,
    type: ProofOfDeliveryType,
    options: { otpCode?: string; file?: Express.Multer.File },
  ) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    if (delivery.driverId !== driverId) {
      throw new ForbiddenException('You are not the driver on this delivery');
    }
    if (delivery.status !== DeliveryStatus.PICKED_UP) {
      throw new BadRequestException(
        'Proof of delivery can only be submitted after pickup is confirmed',
      );
    }

    if (type === ProofOfDeliveryType.OTP) {
      if (
        !options.otpCode ||
        !delivery.receiverOtpHash ||
        delivery.receiverOtpHash !== hashToken(options.otpCode)
      ) {
        throw new BadRequestException('Invalid delivery code');
      }
      const updated = await this.prisma.delivery.update({
        where: { id: deliveryId },
        data: { podType: type, podSubmittedAt: new Date() },
      });
      this.tracking.emitDeliveryStatus(deliveryId, { status: 'DELIVERED' });
      return updated;
    }

    if (!options.file) {
      throw new BadRequestException(`A file is required for proof-of-delivery type ${type}`);
    }
    const fileKey = `pod/${deliveryId}/${type}/${Date.now()}-${options.file.originalname}`;
    await this.r2.uploadObject(fileKey, options.file.buffer, options.file.mimetype);

    const updated = await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { podType: type, podFileKey: fileKey, podSubmittedAt: new Date() },
    });
    this.tracking.emitDeliveryStatus(deliveryId, { status: 'DELIVERED' });
    return updated;
  }

  async completeDelivery(driverId: string, deliveryId: string) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    if (delivery.driverId !== driverId) {
      throw new ForbiddenException('You are not the driver on this delivery');
    }
    if (delivery.status !== DeliveryStatus.PICKED_UP) {
      throw new BadRequestException(`Cannot complete a delivery in status ${delivery.status}`);
    }
    if (!delivery.podType) {
      throw new BadRequestException('Proof of delivery is required before completing');
    }

    // MVP simplification: final fare is the original estimate, not
    // recomputed from actual GPS trace — mirrors TripService.completeTrip.
    const finalFare = delivery.estimatedFare!;
    // As with rides, tax passes through and is never commissioned.
    const taxAmount = delivery.taxAmount ?? new Prisma.Decimal(0);
    const commissionRule = await this.pricing.getActiveCommissionRate(
      'DELIVERY',
      delivery.vehicleType,
    );
    const commissionAmount = roundMoney(finalFare.minus(taxAmount).mul(commissionRule.rate));

    let transactionId: string | undefined;
    const reference = `delivery:${deliveryId}`;
    if (delivery.businessId) {
      // Business-billed: accrue the full fare against the business's
      // credit line now, but don't pay the driver or recognize revenue
      // yet — that happens in BusinessInvoicesService.payInvoice, once the
      // invoice this creates is actually paid. delivery.transactionId
      // deliberately stays null until then (see its own doc comment).
      await this.wallet.chargeBusinessForDelivery(delivery.businessId, finalFare, reference);
      await this.prisma.invoice.create({
        data: {
          businessId: delivery.businessId,
          deliveryId,
          amount: finalFare,
          commissionAmount,
          description: `Delivery to ${delivery.receiverName}`,
          dueAt: new Date(Date.now() + INVOICE_DUE_MS),
        },
      });
    } else if (delivery.paymentMethod === RidePaymentMethod.WALLET) {
      const tx = await this.wallet.payForDelivery(
        delivery.senderId,
        driverId,
        finalFare,
        commissionAmount,
        reference,
        undefined,
        taxAmount,
      );
      transactionId = tx.id;
    } else {
      // Cash: the driver holds the tax too, so it's added to what they owe
      // (see the matching note in TripService.completeTrip).
      await this.wallet.recordCashDeliveryCommission(
        driverId,
        commissionAmount.plus(taxAmount),
        `${reference}:commission`,
        taxAmount.greaterThan(0)
          ? { commission: commissionAmount.toString(), tax: taxAmount.toString() }
          : undefined,
      );
    }

    const completed = await this.prisma.$transaction(async (tx) => {
      await tx.deliveryStop.updateMany({
        where: { deliveryId, status: 'PENDING' },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      return tx.delivery.update({
        where: { id: deliveryId },
        data: {
          status: DeliveryStatus.COMPLETED,
          finalFare,
          commissionAmount,
          completedAt: new Date(),
          transactionId,
        },
      });
    });

    await this.prisma.driverStatus.update({
      where: { userId: driverId },
      data: { availability: DriverAvailability.ONLINE },
    });
    this.tracking.emitDeliveryStatus(deliveryId, {
      status: DeliveryStatus.COMPLETED,
      finalFare: finalFare.toString(),
    });
    this.notifications.notify(
      delivery.senderId,
      NotificationCategory.TRIPS,
      'Delivery completed',
      `Your package has been delivered to ${delivery.receiverName}.`,
      { deliveryId },
    );

    return completed;
  }

  private async recordMilestone(
    driverId: string,
    deliveryId: string,
    requiredStatus: DeliveryStatus,
    field: 'arrivedAtPickupAt' | 'arrivedAtDropoffAt',
  ) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    if (delivery.driverId !== driverId) {
      throw new ForbiddenException('You are not the driver on this delivery');
    }
    if (delivery.status !== requiredStatus) {
      throw new BadRequestException(`Not possible while the delivery is ${delivery.status}`);
    }
    if (delivery[field]) {
      return delivery; // already recorded — a repeated tap is harmless
    }
    const updated = await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { [field]: new Date() },
    });
    this.tracking.emitDeliveryStatus(deliveryId, {
      status: delivery.status,
      milestone: field === 'arrivedAtPickupAt' ? 'ARRIVED_AT_PICKUP' : 'ARRIVED_AT_DROPOFF',
    });
    return updated;
  }

  private async transitionAsDriver(
    driverId: string,
    deliveryId: string,
    fromStatus: DeliveryStatus,
    toStatus: DeliveryStatus,
    extraData: Record<string, unknown>,
  ) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    if (delivery.driverId !== driverId) {
      throw new ForbiddenException('You are not the driver on this delivery');
    }
    if (delivery.status !== fromStatus) {
      throw new BadRequestException(`Cannot move to ${toStatus} from status ${delivery.status}`);
    }

    return this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { status: toStatus, ...extraData },
    });
  }
}
