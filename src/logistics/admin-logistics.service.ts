import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryStatus, DriverAvailability } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { R2Service } from '../integrations/r2/r2.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { LogisticsDispatchService } from './logistics-dispatch.service';

@Injectable()
export class AdminLogisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly dispatch: LogisticsDispatchService,
    private readonly audit: AuditService,
    private readonly r2: R2Service,
  ) {}

  async listDeliveries(take = 50, skip = 0) {
    return this.prisma.delivery.findMany({
      include: { stops: { orderBy: { sequence: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  // Manual override — bypasses the normal offer/accept flow entirely, for
  // the cases dispatch couldn't resolve on its own (NO_DRIVERS_FOUND, a
  // dispute reassignment, etc).
  async assignDriver(deliveryId: string, driverId: string) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    const assignableStatuses: DeliveryStatus[] = [
      DeliveryStatus.REQUESTED,
      DeliveryStatus.DISPATCHING,
      DeliveryStatus.NO_DRIVERS_FOUND,
    ];
    if (!assignableStatuses.includes(delivery.status)) {
      throw new BadRequestException(
        `Cannot manually assign a delivery in status ${delivery.status}`,
      );
    }

    if (delivery.status === DeliveryStatus.DISPATCHING) {
      await this.dispatch.voidPendingOffers(deliveryId);
    }

    await this.prisma.driverStatus.upsert({
      where: { userId: driverId },
      update: { availability: DriverAvailability.ON_TRIP },
      create: { userId: driverId, availability: DriverAvailability.ON_TRIP },
    });

    return this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { driverId, status: DeliveryStatus.ACCEPTED, acceptedAt: new Date() },
    });
  }

  async resolveDispute(deliveryId: string, adminId: string, resolution: string, refund?: boolean) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }

    if (refund) {
      if (!delivery.transactionId) {
        throw new BadRequestException('This delivery has no wallet transaction to refund');
      }
      await this.wallet.refund(delivery.transactionId, `Dispute resolution: ${resolution}`);
    }

    const updated = await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        disputeReason: delivery.disputeReason ?? resolution,
        disputeResolution: resolution,
        disputeResolvedById: adminId,
        disputeResolvedAt: new Date(),
      },
    });

    await this.audit.record(adminId, 'delivery.dispute.resolve', 'Delivery', deliveryId, {
      resolution,
      refunded: !!refund,
    });

    return updated;
  }

  // Not in the plan's endpoint table, but necessary to actually review a
  // signature/photo POD — R2 objects are never public, same rationale as
  // KYC's admin document-review URL endpoint.
  async getSignedPodUrl(deliveryId: string) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    if (!delivery.podFileKey) {
      throw new BadRequestException(
        'This delivery has no photo/signature proof of delivery on file',
      );
    }
    return { url: await this.r2.getSignedReadUrl(delivery.podFileKey) };
  }
}
