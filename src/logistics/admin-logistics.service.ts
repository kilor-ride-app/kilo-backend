import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryStatus, DriverAvailability, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { dateFilter } from '../common/dto/date-range-query.dto';
import {
  describeFilters,
  fullName,
  periodOf,
  resolveActorName,
} from '../common/export/export-helpers';
import { EXPORT_MAX_ROWS, ExportDocument } from '../common/export/export.types';
import { toPaginated } from '../common/utils/paginate.util';
import { tallyByStatus } from '../common/utils/tally.util';
import { R2Service } from '../integrations/r2/r2.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { ExportDeliveriesQueryDto, ListDeliveriesQueryDto } from './dto/list-deliveries-query.dto';
import { LogisticsDispatchService } from './logistics-dispatch.service';

const PARTY = {
  select: { id: true, publicId: true, firstName: true, lastName: true, phone: true },
} as const;
const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.DISPATCHING,
  DeliveryStatus.ACCEPTED,
  DeliveryStatus.PICKED_UP,
];

@Injectable()
export class AdminLogisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly dispatch: LogisticsDispatchService,
    private readonly audit: AuditService,
    private readonly r2: R2Service,
  ) {}

  private deliveryWhere(
    query: Pick<ListDeliveriesQueryDto, 'status' | 'search' | 'from' | 'to'>,
  ): Prisma.DeliveryWhereInput {
    const requestedAt = dateFilter(query.from, query.to);
    const search = query.search?.trim();
    const contains = search ? { contains: search, mode: Prisma.QueryMode.insensitive } : undefined;
    return {
      ...(query.status ? { status: query.status } : {}),
      ...(requestedAt ? { requestedAt } : {}),
      ...(search
        ? {
            OR: [
              { id: { startsWith: search } },
              { publicId: contains },
              { packageDescription: contains },
              { receiverName: contains },
              { sender: { firstName: contains } },
              { sender: { lastName: contains } },
            ],
          }
        : {}),
    };
  }

  async listDeliveries(query: ListDeliveriesQueryDto) {
    const where = this.deliveryWhere(query);
    const take = query.take ?? 50;
    const skip = query.skip ?? 0;
    const [data, total, summary] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        include: {
          stops: { orderBy: { sequence: 'asc' } },
          sender: PARTY,
          driver: PARTY,
          business: { select: { id: true, publicId: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.delivery.count({ where }),
      this.deliverySummary(),
    ]);
    return toPaginated(data, total, { take, skip }, summary);
  }

  /** Platform-wide delivery counts for the stat cards — independent of page/filters. */
  async deliverySummary() {
    const [byStatus, disputed] = await Promise.all([
      this.prisma.delivery.groupBy({ by: ['status'], _count: true }),
      this.prisma.delivery.count({
        where: { disputeReason: { not: null }, disputeResolvedAt: null },
      }),
    ]);
    const t = tallyByStatus(byStatus);
    return {
      total: t.total,
      active: ACTIVE_DELIVERY_STATUSES.reduce((acc, s) => acc + (t[s] ?? 0), 0),
      completed: t[DeliveryStatus.COMPLETED] ?? 0,
      cancelled: t[DeliveryStatus.CANCELLED] ?? 0,
      noDriversFound: t[DeliveryStatus.NO_DRIVERS_FOUND] ?? 0,
      disputed,
    };
  }

  async exportDeliveries(
    query: ExportDeliveriesQueryDto,
    actorId: string,
  ): Promise<ExportDocument> {
    const where = this.deliveryWhere(query);
    const [rows, total, byStatus, settled, generatedBy] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        include: {
          sender: PARTY,
          driver: PARTY,
          business: { select: { id: true, publicId: true, name: true } },
        },
        orderBy: { requestedAt: 'desc' },
        take: EXPORT_MAX_ROWS,
      }),
      this.prisma.delivery.count({ where }),
      this.prisma.delivery.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.delivery.aggregate({
        where: { ...where, status: DeliveryStatus.COMPLETED },
        _sum: { finalFare: true, commissionAmount: true },
      }),
      resolveActorName(this.prisma, actorId),
    ]);
    const t = tallyByStatus(byStatus);
    const completed = t[DeliveryStatus.COMPLETED] ?? 0;
    const active = ACTIVE_DELIVERY_STATUSES.reduce((acc, s) => acc + (t[s] ?? 0), 0);
    const fareVolume = settled._sum.finalFare?.toNumber() ?? 0;

    return {
      title: 'Deliveries Report',
      subtitle: 'Logistics deliveries with sender, driver, fare and disputes',
      generatedBy,
      period: periodOf(query),
      filters: describeFilters({ Search: query.search, Status: query.status }),
      summary: [
        {
          label: 'Total deliveries',
          value: t.total,
          format: 'integer',
          note: 'Deliveries matching the filters.',
        },
        {
          label: 'Completed',
          value: completed,
          format: 'integer',
          tone: 'good',
          note: 'Status COMPLETED.',
        },
        {
          label: 'In progress',
          value: active,
          format: 'integer',
          tone: 'info',
          note: 'Dispatching, accepted or picked up.',
        },
        {
          label: 'Cancelled',
          value: t[DeliveryStatus.CANCELLED] ?? 0,
          format: 'integer',
          tone: 'bad',
          note: 'Status CANCELLED.',
        },
        {
          label: 'No driver found',
          value: t[DeliveryStatus.NO_DRIVERS_FOUND] ?? 0,
          format: 'integer',
          tone: 'warn',
          note: 'Dispatch exhausted every candidate.',
        },
        {
          label: 'Success rate',
          value: t.total > 0 ? completed / t.total : null,
          format: 'percent',
          note: 'Completed ÷ total deliveries.',
        },
        {
          label: 'Fare volume',
          value: fareVolume,
          format: 'currency',
          tone: 'info',
          note: 'Sum of final fares on completed deliveries.',
        },
        {
          label: 'Platform revenue',
          value: settled._sum.commissionAmount?.toNumber() ?? 0,
          format: 'currency',
          tone: 'good',
          note: 'Commission earned on completed deliveries.',
        },
      ],
      sections: [
        {
          name: 'Deliveries',
          description: 'One row per delivery, newest first.',
          truncatedFrom: total > rows.length ? total : undefined,
          columns: [
            { key: 'ref', header: 'Delivery', width: 12 },
            { key: 'requestedAt', header: 'Requested', format: 'datetime' },
            { key: 'status', header: 'Status', format: 'status' },
            { key: 'sender', header: 'Sender', width: 22 },
            { key: 'business', header: 'Business', width: 22 },
            { key: 'driver', header: 'Driver', width: 22 },
            { key: 'vehicleType', header: 'Vehicle', width: 14 },
            { key: 'paymentMethod', header: 'Payment', format: 'status' },
            { key: 'pickupAddress', header: 'Pickup', width: 30 },
            { key: 'packageDescription', header: 'Package', width: 26 },
            { key: 'receiverName', header: 'Receiver', width: 20 },
            { key: 'distanceKm', header: 'Distance (km)', format: 'number' },
            { key: 'finalFare', header: 'Fare', format: 'currency', total: true },
            { key: 'commissionAmount', header: 'Commission', format: 'currency', total: true },
            { key: 'dispute', header: 'Dispute', format: 'status' },
          ],
          rows: rows.map((r) => ({
            ...r,
            ref: r.id.slice(0, 8),
            sender: fullName(r.sender ?? {}) || '—',
            business: r.business?.name ?? '',
            driver: fullName(r.driver ?? {}) || 'Unassigned',
            dispute: r.disputeReason ? (r.disputeResolvedAt ? 'RESOLVED' : 'DISPUTED') : '',
          })),
        },
      ],
    };
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
