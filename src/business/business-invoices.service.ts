import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { CreateDeliveryDto } from '../logistics/dto/create-delivery.dto';
import { LogisticsService } from '../logistics/logistics.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { BusinessService } from './business.service';

// Same shape as an individual booking; paymentMethod is ignored —
// business-billed deliveries are always BUSINESS_INVOICE.
type DeliveryScheduleItem = CreateDeliveryDto;

@Injectable()
export class BusinessInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly business: BusinessService,
    private readonly logistics: LogisticsService,
  ) {}

  async scheduleDeliveries(userId: string, businessId: string, items: DeliveryScheduleItem[]) {
    await this.business.assertMember(userId, businessId);

    const created = [];
    for (const item of items) {
      const quote = await this.logistics.quote({
        pickupLat: item.pickupLat,
        pickupLng: item.pickupLng,
        stops: item.stops,
        vehicleType: item.vehicleType,
        serviceType: item.serviceType,
      });
      const estimatedFare = quote.quotes[0]?.estimatedFare;
      if (!estimatedFare) {
        throw new BadRequestException(`No active tariff for vehicle type ${item.vehicleType}`);
      }
      await this.business.assertWithinCreditLimit(businessId, estimatedFare);

      const delivery = await this.logistics.createDelivery(userId, item, businessId);
      created.push(delivery);
    }
    return created;
  }

  async listInvoices(userId: string, businessId: string, take = 50, skip = 0) {
    await this.business.assertMember(userId, businessId);
    return this.prisma.invoice.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  async getInvoice(userId: string, businessId: string, invoiceId: string) {
    await this.business.assertMember(userId, businessId);
    const invoice = await this.findInvoiceOrThrow(businessId, invoiceId);
    return invoice;
  }

  async payInvoice(userId: string, businessId: string, invoiceId: string) {
    await this.business.assertAdmin(userId, businessId);
    const invoice = await this.findInvoiceOrThrow(businessId, invoiceId);
    if (invoice.status !== InvoiceStatus.PENDING) {
      throw new BadRequestException(`Invoice is already ${invoice.status.toLowerCase()}`);
    }
    if (!invoice.deliveryId) {
      throw new BadRequestException('This invoice has no linked delivery to pay a driver for');
    }
    const delivery = await this.prisma.delivery.findUniqueOrThrow({
      where: { id: invoice.deliveryId },
    });
    if (!delivery.driverId) {
      throw new BadRequestException('This delivery has no assigned driver to pay');
    }

    const tx = await this.wallet.payInvoice(
      businessId,
      delivery.driverId,
      invoice.amount,
      invoice.commissionAmount,
      `invoice:${invoiceId}`,
      undefined,
      delivery.taxAmount ?? undefined,
    );

    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.PAID, paidAt: new Date(), transactionId: tx.id },
    });
  }

  private async findInvoiceOrThrow(businessId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || invoice.businessId !== businessId) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }
}
