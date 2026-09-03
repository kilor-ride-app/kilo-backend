import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountType,
  ChargingStationStatus,
  DeliveryStatus,
  DriverAvailability,
  KycStatus,
  Prisma,
  RideStatus,
  TicketStatus,
  TransactionStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { toPaginated } from '../common/utils/paginate.util';
import { startOfUtcDay } from '../common/utils/time-bucket.util';
import { ListAuditQueryDto } from './dto/list-audit-query.dto';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { ListDriversQueryDto } from './dto/list-drivers-query.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

// Same key DispatchService GEOADDs live driver positions into — duplicated
// here rather than importing DispatchService, since AdminOps only ever
// needs read access to this one Redis structure, not the dispatch engine.
const GEO_KEY = 'drivers:geo';

const ACTIVE_RIDE_STATUSES: RideStatus[] = [
  RideStatus.DISPATCHING,
  RideStatus.ACCEPTED,
  RideStatus.ARRIVED,
  RideStatus.IN_PROGRESS,
];

const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.DISPATCHING,
  DeliveryStatus.ACCEPTED,
  DeliveryStatus.PICKED_UP,
];

const USER_SUMMARY_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  createdAt: true,
} as const;

const USER_DETAIL_SELECT = {
  ...USER_SUMMARY_SELECT,
  emailVerifiedAt: true,
  profilePhotoUrl: true,
  updatedAt: true,
} as const;

const RIDE_LIST_SELECT = {
  id: true,
  status: true,
  vehicleType: true,
  paymentMethod: true,
  pickupAddress: true,
  dropoffAddress: true,
  distanceKm: true,
  durationMinutes: true,
  estimatedFare: true,
  finalFare: true,
  commissionAmount: true,
  riderId: true,
  driverId: true,
  requestedAt: true,
  completedAt: true,
  cancelledAt: true,
} as const;

const DELIVERY_LIST_SELECT = {
  id: true,
  status: true,
  vehicleType: true,
  paymentMethod: true,
  pickupAddress: true,
  packageDescription: true,
  estimatedFare: true,
  finalFare: true,
  commissionAmount: true,
  senderId: true,
  driverId: true,
  businessId: true,
  requestedAt: true,
  completedAt: true,
} as const;

// groupBy rows -> { STATUS: count, ..., total }
function tallyByStatus(rows: Array<{ status: string; _count: number }>) {
  const out: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    out[r.status] = r._count;
    total += r._count;
  }
  return { ...out, total };
}

@Injectable()
export class AdminOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly wallet: WalletService,
    private readonly platformConfig: PlatformConfigService,
    private readonly audit: AuditService,
  ) {}

  async getDashboardSummary() {
    const startOfToday = startOfUtcDay();

    const [
      riderCount,
      driverCount,
      onlineDriverCount,
      totalRides,
      completedRides,
      cancelledRides,
      activeTrips,
      activeDeliveries,
      pendingKycRows,
      disputedDeliveries,
      pendingWithdrawals,
      rideRevenueToday,
      deliveryRevenueToday,
      walletPool,
      platformRevenue,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: UserRole.RIDER } }),
      this.prisma.user.count({ where: { role: UserRole.DRIVER } }),
      this.prisma.driverStatus.count({
        where: { availability: { not: DriverAvailability.OFFLINE } },
      }),
      this.prisma.ride.count(),
      this.prisma.ride.count({ where: { status: RideStatus.COMPLETED } }),
      this.prisma.ride.count({ where: { status: RideStatus.CANCELLED } }),
      this.prisma.ride.count({ where: { status: { in: ACTIVE_RIDE_STATUSES } } }),
      this.prisma.delivery.count({ where: { status: { in: ACTIVE_DELIVERY_STATUSES } } }),
      // distinct drivers with at least one document still awaiting review
      this.prisma.kycDocument.groupBy({ by: ['driverId'], where: { status: KycStatus.PENDING } }),
      this.prisma.delivery.count({
        where: { disputeReason: { not: null }, disputeResolvedAt: null },
      }),
      this.prisma.withdrawalRequest.aggregate({
        where: { status: TransactionStatus.PENDING },
        _count: true,
        _sum: { amount: true },
      }),
      this.prisma.ride.aggregate({
        where: { status: RideStatus.COMPLETED, completedAt: { gte: startOfToday } },
        _sum: { commissionAmount: true },
      }),
      this.prisma.delivery.aggregate({
        where: { status: DeliveryStatus.COMPLETED, completedAt: { gte: startOfToday } },
        _sum: { commissionAmount: true },
      }),
      this.prisma.account.aggregate({
        where: { type: { in: [AccountType.RIDER_WALLET, AccountType.DRIVER_WALLET] } },
        _sum: { balance: true },
      }),
      this.wallet.getPlatformAccount(AccountType.PLATFORM_REVENUE),
    ]);

    const todayRevenue = (rideRevenueToday._sum.commissionAmount ?? new Prisma.Decimal(0)).plus(
      deliveryRevenueToday._sum.commissionAmount ?? new Prisma.Decimal(0),
    );

    return {
      riders: riderCount,
      drivers: driverCount,
      onlineDrivers: onlineDriverCount,
      rides: { total: totalRides, completed: completedRides, cancelled: cancelledRides },
      activeTrips,
      activeDeliveries,
      pendingKyc: pendingKycRows.length,
      disputedDeliveries,
      pendingWithdrawals: {
        count: pendingWithdrawals._count,
        amount: pendingWithdrawals._sum.amount ?? new Prisma.Decimal(0),
      },
      todayRevenue,
      walletPool: walletPool._sum.balance ?? new Prisma.Decimal(0),
      totalRevenue: platformRevenue.balance,
    };
  }

  // Feeds the dashboard's "Needs Attention" list — each operational backlog
  // that currently has a non-zero count, most urgent first.
  async getNeedsAttention() {
    const [
      pendingKycRows,
      pendingWithdrawals,
      disputedDeliveries,
      escalatedTickets,
      offlineStations,
    ] = await Promise.all([
      this.prisma.kycDocument.groupBy({ by: ['driverId'], where: { status: KycStatus.PENDING } }),
      this.prisma.withdrawalRequest.count({ where: { status: TransactionStatus.PENDING } }),
      this.prisma.delivery.count({
        where: { disputeReason: { not: null }, disputeResolvedAt: null },
      }),
      this.prisma.supportTicket.count({ where: { status: TicketStatus.ESCALATED } }),
      this.prisma.chargingStation.count({ where: { status: ChargingStationStatus.OFFLINE } }),
    ]);

    const items = [
      {
        type: 'kyc',
        severity: 'warning',
        count: pendingKycRows.length,
        message: `${pendingKycRows.length} KYC submission(s) pending review`,
        href: '/dashboard/driver-management',
      },
      {
        type: 'withdrawals',
        severity: 'warning',
        count: pendingWithdrawals,
        message: `${pendingWithdrawals} withdrawal request(s) awaiting approval`,
        href: '/dashboard/finance',
      },
      {
        type: 'disputes',
        severity: 'alert',
        count: disputedDeliveries,
        message: `${disputedDeliveries} disputed delivery(ies) need investigation`,
        href: '/dashboard/rides',
      },
      {
        type: 'tickets',
        severity: 'alert',
        count: escalatedTickets,
        message: `${escalatedTickets} escalated support ticket(s)`,
        href: '/dashboard/notifications',
      },
      {
        type: 'stations',
        severity: 'warning',
        count: offlineStations,
        message: `${offlineStations} charging station(s) offline`,
        href: '/dashboard/kilowatt',
      },
    ];

    return items.filter((i) => i.count > 0);
  }

  async getLiveMap() {
    const driverIds = await this.redis.client.zrange(GEO_KEY, 0, -1);
    let onlineDrivers: Array<{ driverId: string; lat: number; lng: number }> = [];

    if (driverIds.length > 0) {
      const positions = await this.redis.client.geopos(GEO_KEY, ...driverIds);
      const withPositions = driverIds
        .map((driverId, i) => ({ driverId, coords: positions[i] }))
        .filter((d): d is { driverId: string; coords: [string, string] } => d.coords !== null);

      const statuses = await this.prisma.driverStatus.findMany({
        where: {
          userId: { in: withPositions.map((d) => d.driverId) },
          availability: DriverAvailability.ONLINE,
        },
        select: { userId: true },
      });
      const onlineIds = new Set(statuses.map((s) => s.userId));

      onlineDrivers = withPositions
        .filter((d) => onlineIds.has(d.driverId))
        .map((d) => ({ driverId: d.driverId, lng: Number(d.coords[0]), lat: Number(d.coords[1]) }));
    }

    const activeRides = await this.prisma.ride.findMany({
      where: { status: { in: ACTIVE_RIDE_STATUSES } },
      select: {
        id: true,
        status: true,
        driverId: true,
        pickupLat: true,
        pickupLng: true,
        dropoffLat: true,
        dropoffLng: true,
      },
    });

    return { onlineDrivers, activeRides };
  }

  // ── Lists ─────────────────────────────────────────────────────────────

  listRiders(query: ListUsersQueryDto) {
    return this.prisma.user.findMany({
      where: this.userListWhere(UserRole.RIDER, query),
      select: USER_SUMMARY_SELECT,
      orderBy: { createdAt: 'desc' },
      take: query.take ?? 50,
      skip: query.skip ?? 0,
    });
  }

  listDrivers(query: ListDriversQueryDto) {
    return this.prisma.user.findMany({
      where: {
        ...this.userListWhere(UserRole.DRIVER, query),
        ...(query.availability ? { driverStatus: { availability: query.availability } } : {}),
      },
      select: {
        ...USER_SUMMARY_SELECT,
        driverStatus: { select: { availability: true, serviceMode: true, vehicleType: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: query.take ?? 50,
      skip: query.skip ?? 0,
    });
  }

  private userListWhere(role: UserRole, query: ListUsersQueryDto): Prisma.UserWhereInput {
    return {
      role,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  // ── Detail (the "360" view) ──────────────────────────────────────────

  async getRiderDetail(id: string) {
    const user = await this.getUserOrThrow(id, UserRole.RIDER);

    const [rideStats, deliveryStats, wallet, activeRide, promo, referral, devices, ticketStats] =
      await Promise.all([
        this.prisma.ride.groupBy({ by: ['status'], where: { riderId: id }, _count: true }),
        this.prisma.delivery.groupBy({ by: ['status'], where: { senderId: id }, _count: true }),
        this.prisma.account.findUnique({
          where: { ownerId_type: { ownerId: id, type: AccountType.RIDER_WALLET } },
          select: { balance: true, currency: true },
        }),
        this.prisma.ride.findFirst({
          where: { riderId: id, status: { in: ACTIVE_RIDE_STATUSES } },
          select: { id: true, status: true, driverId: true },
        }),
        this.prisma.promoRedemption.aggregate({
          where: { userId: id },
          _count: true,
          _sum: { discountAmount: true },
        }),
        this.prisma.referralCode.findUnique({
          where: { userId: id },
          select: { code: true, redemptions: { select: { status: true, earningsAmount: true } } },
        }),
        this.prisma.deviceToken.aggregate({
          where: { userId: id },
          _count: true,
          _max: { createdAt: true },
        }),
        this.prisma.supportTicket.groupBy({ by: ['status'], where: { userId: id }, _count: true }),
      ]);

    return {
      ...user,
      wallet: { balance: wallet?.balance ?? 0, currency: wallet?.currency ?? 'NGN' },
      activeRide,
      rides: tallyByStatus(rideStats),
      deliveriesSent: tallyByStatus(deliveryStats),
      promo: {
        redemptions: promo._count,
        totalDiscount: promo._sum.discountAmount ?? 0,
      },
      referral: referral
        ? {
            code: referral.code,
            successfulReferrals: referral.redemptions.filter((r) => r.status !== 'PENDING').length,
            totalEarnings: referral.redemptions.reduce(
              (sum, r) => sum.plus(r.earningsAmount),
              new Prisma.Decimal(0),
            ),
          }
        : null,
      devices: { count: devices._count, lastRegisteredAt: devices._max.createdAt },
      supportTickets: tallyByStatus(ticketStats),
    };
  }

  async getDriverDetail(id: string) {
    const user = await this.getUserOrThrow(id, UserRole.DRIVER);

    const [
      rideStats,
      deliveryStats,
      driverStatus,
      wallet,
      commissionPayable,
      rating,
      withdrawalStats,
      kycDocuments,
      kycVerifications,
      guarantor,
      fleet,
      devices,
      ticketStats,
      activeRide,
      activeDelivery,
      liveLocation,
    ] = await Promise.all([
      this.prisma.ride.groupBy({ by: ['status'], where: { driverId: id }, _count: true }),
      this.prisma.delivery.groupBy({ by: ['status'], where: { driverId: id }, _count: true }),
      this.prisma.driverStatus.findUnique({ where: { userId: id } }),
      this.prisma.account.findUnique({
        where: { ownerId_type: { ownerId: id, type: AccountType.DRIVER_WALLET } },
        select: { balance: true, currency: true },
      }),
      this.prisma.account.findUnique({
        where: { ownerId_type: { ownerId: id, type: AccountType.DRIVER_COMMISSION_PAYABLE } },
        select: { balance: true },
      }),
      this.prisma.rideRating.aggregate({
        where: { ride: { driverId: id } },
        _avg: { rating: true },
        _count: true,
      }),
      this.prisma.withdrawalRequest.groupBy({
        by: ['status'],
        where: { driverId: id },
        _count: true,
        _sum: { amount: true },
      }),
      this.prisma.kycDocument.findMany({
        where: { driverId: id },
        select: {
          id: true,
          type: true,
          status: true,
          rejectionReason: true,
          reviewedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.kycVerification.findMany({
        where: { driverId: id },
        select: { id: true, type: true, status: true, verifiedAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.guarantor.findFirst({
        where: { driverId: id },
        select: {
          id: true,
          status: true,
          fullName: true,
          submittedAt: true,
          reviewedAt: true,
          rejectionReason: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.fleetPartnerDriver.findUnique({
        where: { driverId: id },
        select: { attachedAt: true, fleetPartner: { select: { id: true, name: true } } },
      }),
      this.prisma.deviceToken.aggregate({
        where: { userId: id },
        _count: true,
        _max: { createdAt: true },
      }),
      this.prisma.supportTicket.groupBy({ by: ['status'], where: { userId: id }, _count: true }),
      this.prisma.ride.findFirst({
        where: { driverId: id, status: { in: ACTIVE_RIDE_STATUSES } },
        select: { id: true, status: true, riderId: true },
      }),
      this.prisma.delivery.findFirst({
        where: { driverId: id, status: { in: ACTIVE_DELIVERY_STATUSES } },
        select: { id: true, status: true, senderId: true },
      }),
      this.getLiveLocation(id),
    ]);

    return {
      ...user,
      driverStatus: driverStatus
        ? {
            availability: driverStatus.availability,
            serviceMode: driverStatus.serviceMode,
            vehicleType: driverStatus.vehicleType,
            unsettledCashRideCount: driverStatus.unsettledCashRideCount,
          }
        : { availability: DriverAvailability.OFFLINE, unsettledCashRideCount: 0 },
      liveLocation,
      activeRide,
      activeDelivery,
      wallet: {
        balance: wallet?.balance ?? 0,
        currency: wallet?.currency ?? 'NGN',
        outstandingCommission: commissionPayable?.balance ?? 0,
      },
      rating: { average: rating._avg.rating, count: rating._count },
      rides: tallyByStatus(rideStats),
      deliveries: tallyByStatus(deliveryStats),
      withdrawals: Object.fromEntries(
        withdrawalStats.map((w) => [w.status, { count: w._count, amount: w._sum.amount ?? 0 }]),
      ),
      kyc: { documents: kycDocuments, verifications: kycVerifications },
      guarantor,
      fleetPartner: fleet ? { ...fleet.fleetPartner, attachedAt: fleet.attachedAt } : null,
      devices: { count: devices._count, lastRegisteredAt: devices._max.createdAt },
      supportTickets: tallyByStatus(ticketStats),
    };
  }

  // ── Per-user history (paginated sub-resources) ───────────────────────

  async getRiderRides(id: string, take: number, skip: number) {
    await this.assertRole(id, UserRole.RIDER);
    return this.prisma.ride.findMany({
      where: { riderId: id },
      select: RIDE_LIST_SELECT,
      orderBy: { requestedAt: 'desc' },
      take,
      skip,
    });
  }

  async getRiderDeliveries(id: string, take: number, skip: number) {
    await this.assertRole(id, UserRole.RIDER);
    return this.prisma.delivery.findMany({
      where: { senderId: id },
      select: DELIVERY_LIST_SELECT,
      orderBy: { requestedAt: 'desc' },
      take,
      skip,
    });
  }

  async getDriverRides(id: string, take: number, skip: number) {
    await this.assertRole(id, UserRole.DRIVER);
    return this.prisma.ride.findMany({
      where: { driverId: id },
      select: RIDE_LIST_SELECT,
      orderBy: { requestedAt: 'desc' },
      take,
      skip,
    });
  }

  async getDriverDeliveries(id: string, take: number, skip: number) {
    await this.assertRole(id, UserRole.DRIVER);
    return this.prisma.delivery.findMany({
      where: { driverId: id },
      select: DELIVERY_LIST_SELECT,
      orderBy: { requestedAt: 'desc' },
      take,
      skip,
    });
  }

  async getDriverWithdrawals(id: string, take: number, skip: number) {
    await this.assertRole(id, UserRole.DRIVER);
    return this.prisma.withdrawalRequest.findMany({
      where: { driverId: id },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  // Every wallet Transaction that touched any account this user owns
  // (rider wallet, or driver wallet + commission-payable), newest first.
  async getUserTransactions(id: string, take: number, skip: number) {
    const accounts = await this.prisma.account.findMany({
      where: { ownerId: id },
      select: { id: true },
    });
    if (accounts.length === 0) {
      return [];
    }
    const accountIds = accounts.map((a) => a.id);
    return this.prisma.transaction.findMany({
      where: { entries: { some: { accountId: { in: accountIds } } } },
      include: { entries: { where: { accountId: { in: accountIds } } } },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  // ── Suspend / activate ──────────────────────────────────────────────

  async suspendUser(id: string, actorId: string, reason?: string) {
    const user = await this.setUserStatus(id, UserStatus.SUSPENDED);
    await this.audit.record(actorId, 'user.suspend', 'User', id, reason ? { reason } : undefined);
    return user;
  }

  async activateUser(id: string, actorId: string) {
    const user = await this.setUserStatus(id, UserStatus.ACTIVE);
    await this.audit.record(actorId, 'user.activate', 'User', id);
    return user;
  }

  async getConfig() {
    return this.platformConfig.getAll();
  }

  async updateConfig(updates: Record<string, unknown>, actorId: string) {
    for (const [key, value] of Object.entries(updates)) {
      await this.platformConfig.set(key, value);
    }
    await this.audit.record(
      actorId,
      'config.update',
      'PlatformConfig',
      undefined,
      updates as Prisma.InputJsonValue,
    );
    return this.platformConfig.getAll();
  }

  async getAuditLogs(query: ListAuditQueryDto) {
    const { data, total } = await this.audit.list(
      {
        action: query.action,
        targetType: query.targetType,
        actorId: query.actorId,
        from: query.from,
        to: query.to,
      },
      query.take ?? 50,
      query.skip ?? 0,
    );
    return toPaginated(data, total, query);
  }

  // ── internals ───────────────────────────────────────────────────────

  private async getLiveLocation(driverId: string): Promise<{ lat: number; lng: number } | null> {
    const pos = await this.redis.client.geopos(GEO_KEY, driverId);
    const coords = pos?.[0];
    return coords ? { lat: Number(coords[1]), lng: Number(coords[0]) } : null;
  }

  private async getUserOrThrow(id: string, role: UserRole) {
    const user = await this.prisma.user.findFirst({
      where: { id, role },
      select: USER_DETAIL_SELECT,
    });
    if (!user) {
      throw new NotFoundException(`${role === UserRole.RIDER ? 'Rider' : 'Driver'} not found`);
    }
    return user;
  }

  private async assertRole(id: string, role: UserRole) {
    const found = await this.prisma.user.findFirst({ where: { id, role }, select: { id: true } });
    if (!found) {
      throw new NotFoundException(`${role === UserRole.RIDER ? 'Rider' : 'Driver'} not found`);
    }
  }

  private async setUserStatus(id: string, status: UserStatus) {
    const result = await this.prisma.user.updateMany({
      where: { id, role: { in: [UserRole.RIDER, UserRole.DRIVER] } },
      data: { status },
    });
    if (result.count === 0) {
      throw new NotFoundException('User not found');
    }
    return this.prisma.user.findUniqueOrThrow({ where: { id }, select: USER_DETAIL_SELECT });
  }
}
