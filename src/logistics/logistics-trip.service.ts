import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryStatus,
  DriverAvailability,
  ProofOfDeliveryType,
  RidePaymentMethod,
} from '@prisma/client';
import { hashToken } from '../common/utils/token.util';
import { R2Service } from '../integrations/r2/r2.service';
import { PricingService } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

const INVOICE_DUE_MS = 14 * 24 * 60 * 60 * 1000; // net-14

@Injectable()
export class LogisticsTripService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly wallet: WalletService,
    private readonly r2: R2Service,
  ) {}

  async confirmPickup(driverId: string, deliveryId: string) {
    const delivery = await this.transitionAsDriver(
      driverId,
      deliveryId,
      DeliveryStatus.ACCEPTED,
      DeliveryStatus.PICKED_UP,
      { pickedUpAt: new Date() },
    );
    return delivery;
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
      return this.prisma.delivery.update({ where: { id: deliveryId }, data: { podType: type } });
    }

    if (!options.file) {
      throw new BadRequestException(`A file is required for proof-of-delivery type ${type}`);
    }
    const fileKey = `pod/${deliveryId}/${type}/${Date.now()}-${options.file.originalname}`;
    await this.r2.uploadObject(fileKey, options.file.buffer, options.file.mimetype);

    return this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { podType: type, podFileKey: fileKey },
    });
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
    const commissionRule = await this.pricing.getActiveCommissionRate(
      'DELIVERY',
      delivery.vehicleType,
    );
    const commissionAmount = finalFare.mul(commissionRule.rate);

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
      );
      transactionId = tx.id;
    } else {
      await this.wallet.recordCashDeliveryCommission(
        driverId,
        commissionAmount,
        `${reference}:commission`,
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

    return completed;
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
