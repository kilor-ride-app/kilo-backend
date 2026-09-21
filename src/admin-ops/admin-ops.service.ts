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
import { startOfUtcDay } from '../common/utils/time-bucket.util';
import { ExportAuditQueryDto, ListAuditQueryDto } from './dto/list-audit-query.dto';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { ExportDriversQueryDto, ListDriversQueryDto } from './dto/list-drivers-query.dto';
import { ExportUsersQueryDto, ListUsersQueryDto } from './dto/list-users-query.dto';

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
  profilePhotoUrl: true,
  createdAt: true,
} as const;

// Rides/deliveries whose money is final — what the list-view lifetime
// totals (trips, earnings, commission) are summed over.
const SETTLED_RIDE_STATUS: RideStatus = RideStatus.COMPLETED;
const SETTLED_DELIVERY_STATUS: DeliveryStatus = DeliveryStatus.COMPLETED;

function decimalToFixed(value: Prisma.Decimal | null | undefined): string {
  return (value ?? new Prisma.Decimal(0)).toFixed(2);
}

// "minLat,minLng,maxLat,maxLng" → bounding box, or null if unparseable.
function parseBounds(
  raw?: string,
): { minLat: number; minLng: number; maxLat: number; maxLng: number } | null {
  if (!raw) {
    return null;
  }
  const parts = raw.split(',').map((n) => Number(n.trim()));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    return null;
  }
  const [minLat, minLng, maxLat, maxLng] = parts;
  return { minLat, minLng, maxLat, maxLng };
}

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

// Summary block shared by the ride/delivery history routes. A rider sees what
// they spent; a driver what they earned (fare minus platform commission) —
// both over COMPLETED trips only.
function historySummary(
  party: 'rider' | 'driver',
  total: number,
  byStatus: Array<{ status: string; _count: number }>,
  settled: { finalFare: Prisma.Decimal | null; commissionAmount: Prisma.Decimal | null },
) {
  const counts = tallyByStatus(byStatus);
  delete counts.total; // the by-status breakdown excludes the grand total
  const gross = settled.finalFare ?? new Prisma.Decimal(0);
  const commission = settled.commissionAmount ?? new Prisma.Decimal(0);
  return {
    total,
    completed: counts.COMPLETED ?? 0,
    cancelled: counts.CANCELLED ?? 0,
    byStatus: counts,
    ...(party === 'rider'
      ? { totalSpent: decimalToFixed(gross) }
      : {
          totalEarnings: decimalToFixed(gross.minus(commission)),
          totalCommission: decimalToFixed(commission),
        }),
  };
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

  // ── Live map (fleet REST payload) ────────────────────────────────────
  // Best-effort snapshot for the admin live map. Real-time telemetry
  // (speed, heading, per-trip current position) has no producer yet — the
  // only live signal is driver lng/lat in the Redis GEO set. speedKmH /
  // heading are therefore omitted; a driver's Redis position doubles as
  // the "currentLocation" for their active trip/delivery.
  async getFleetMap(query: { state?: string; bounds?: string }) {
    const box = parseBounds(query.bounds);

    const geoDriverIds = await this.redis.client.zrange(GEO_KEY, 0, -1);
    const positionById = new Map<string, { lat: number; lng: number }>();
    if (geoDriverIds.length > 0) {
      const positions = await this.redis.client.geopos(GEO_KEY, ...geoDriverIds);
      geoDriverIds.forEach((id, i) => {
        const coords = positions[i];
        if (coords) {
          positionById.set(id, { lng: Number(coords[0]), lat: Number(coords[1]) });
        }
      });
    }

    const [statuses, activeRides, activeDeliveries, stations, onlineCount, offlineCount] =
      await Promise.all([
        this.prisma.driverStatus.findMany({
          where: { availability: { not: DriverAvailability.OFFLINE } },
          select: { userId: true, availability: true, serviceMode: true, vehicleType: true },
        }),
        this.prisma.ride.findMany({
          where: { status: { in: ACTIVE_RIDE_STATUSES } },
          select: {
            id: true,
            status: true,
            driverId: true,
            riderId: true,
            finalFare: true,
            estimatedFare: true,
            pickupLat: true,
            pickupLng: true,
            pickupAddress: true,
            dropoffLat: true,
            dropoffLng: true,
            dropoffAddress: true,
          },
        }),
        this.prisma.delivery.findMany({
          where: { status: { in: ACTIVE_DELIVERY_STATUSES } },
          select: {
            id: true,
            status: true,
            driverId: true,
            packageDescription: true,
            pickupLat: true,
            pickupLng: true,
          },
        }),
        this.prisma.chargingStation.findMany({
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            lat: true,
            lng: true,
            connectorCount: true,
            availableBays: true,
            status: true,
          },
        }),
        this.prisma.driverStatus.count({ where: { availability: DriverAvailability.ONLINE } }),
        this.prisma.driverStatus.count({ where: { availability: DriverAvailability.OFFLINE } }),
      ]);

    // Names/phones for every driver referenced by a status, ride or delivery.
    const namedIds = new Set<string>([
      ...statuses.map((s) => s.userId),
      ...activeRides.map((r) => r.driverId).filter((id): id is string => !!id),
      ...activeDeliveries.map((d) => d.driverId).filter((id): id is string => !!id),
    ]);
    const users = namedIds.size
      ? await this.prisma.user.findMany({
          where: { id: { in: [...namedIds] } },
          select: { id: true, firstName: true, lastName: true, phone: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));
    const nameOf = (id?: string | null) => {
      const u = id ? userById.get(id) : undefined;
      return u ? `${u.firstName} ${u.lastName}`.trim() : null;
    };

    const inBox = (lat: number, lng: number) =>
      !box || (lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng);

    const drivers = statuses
      .map((s) => {
        const pos = positionById.get(s.userId);
        const u = userById.get(s.userId);
        return {
          id: s.userId,
          name: u ? `${u.firstName} ${u.lastName}`.trim() : null,
          phone: u?.phone ?? null,
          status: s.availability,
          activity: s.serviceMode,
          lat: pos?.lat ?? null,
          lng: pos?.lng ?? null,
          vehicle: s.vehicleType ? { type: s.vehicleType } : null,
        };
      })
      .filter((d) => d.lat === null || inBox(d.lat, d.lng as number));

    const trips = activeRides
      .filter((r) => inBox(r.pickupLat, r.pickupLng))
      .map((r) => {
        const pos = r.driverId ? positionById.get(r.driverId) : undefined;
        return {
          id: r.id,
          driverId: r.driverId,
          driverName: nameOf(r.driverId),
          riderId: r.riderId,
          status: r.status,
          fare: decimalToFixed(r.finalFare ?? r.estimatedFare),
          pickup: { lat: r.pickupLat, lng: r.pickupLng, address: r.pickupAddress },
          destination: { lat: r.dropoffLat, lng: r.dropoffLng, address: r.dropoffAddress },
          currentLocation: pos ?? null,
        };
      });

    const deliveries = activeDeliveries
      .filter((d) => inBox(d.pickupLat, d.pickupLng))
      .map((d) => {
        const pos = d.driverId ? positionById.get(d.driverId) : undefined;
        return {
          id: d.id,
          driverId: d.driverId,
          driverName: nameOf(d.driverId),
          status: d.status,
          packageType: d.packageDescription,
          currentLocation: pos ?? null,
        };
      });

    const mappedStations = stations
      .filter((s) => inBox(s.lat, s.lng))
      .map((s) => ({
        id: s.id,
        name: s.name,
        type: 'CHARGING_STATION' as const,
        lat: s.lat,
        lng: s.lng,
        totalBays: s.connectorCount,
        availableBays: s.availableBays,
        status: s.status,
      }));

    return {
      timestamp: new Date().toISOString(),
      summary: {
        onlineDrivers: onlineCount,
        onTripRides: activeRides.length,
        onDeliveries: activeDeliveries.length,
        activeChargingHubs: mappedStations.filter(
          (s) => s.status === 'AVAILABLE' || s.status === 'BUSY' || s.status === 'OPERATIONAL',
        ).length,
        offlineDrivers: offlineCount,
      },
      drivers,
      trips,
      deliveries,
      stations: mappedStations,
    };
  }

  // ── Lists ─────────────────────────────────────────────────────────────

  async listRiders(query: ListUsersQueryDto) {
    const where = this.userListWhere(UserRole.RIDER, query);
    const [riders, total, summary] = await Promise.all([
      this.riderRows(where, query.take ?? 50, query.skip ?? 0),
      this.prisma.user.count({ where }),
      this.riderSummary(),
    ]);
    return toPaginated(riders, total, query, summary);
  }

  async listDrivers(query: ListDriversQueryDto) {
    const where = await this.driverListWhere(query);
    const [drivers, total, summary] = await Promise.all([
      this.driverRows(where, query.take ?? 50, query.skip ?? 0),
      this.prisma.user.count({ where }),
      this.driverSummary(),
    ]);
    return toPaginated(drivers, total, query, summary);
  }

  /** Platform-wide rider counts for the stat cards — independent of page/filters. */
  async riderSummary() {
    const day = 24 * 60 * 60 * 1000;
    const role = UserRole.RIDER;
    const [byStatus, newLast7Days, newLast30Days, wallets] = await Promise.all([
      this.prisma.user.groupBy({ by: ['status'], where: { role }, _count: true }),
      this.prisma.user.count({
        where: { role, createdAt: { gte: new Date(Date.now() - 7 * day) } },
      }),
      this.prisma.user.count({
        where: { role, createdAt: { gte: new Date(Date.now() - 30 * day) } },
      }),
      this.prisma.account.aggregate({
        where: { type: AccountType.RIDER_WALLET },
        _sum: { balance: true },
      }),
    ]);
    const status = tallyByStatus(byStatus);
    return {
      total: status.total,
      active: status[UserStatus.ACTIVE] ?? 0,
      suspended: status[UserStatus.SUSPENDED] ?? 0,
      pendingVerification: status[UserStatus.PENDING_VERIFICATION] ?? 0,
      newLast7Days,
      newLast30Days,
      totalWalletBalance: decimalToFixed(wallets._sum.balance),
    };
  }

  /**
   * Platform-wide driver counts for the stat cards — independent of
   * page/filters. `online` counts every driver not OFFLINE (available +
   * on a trip), the same definition as the dashboard's online figure.
   */
  async driverSummary() {
    const day = 24 * 60 * 60 * 1000;
    const role = UserRole.DRIVER;
    const [byStatus, byAvailability, kycStates, newLast30Days] = await Promise.all([
      this.prisma.user.groupBy({ by: ['status'], where: { role }, _count: true }),
      this.prisma.driverStatus.groupBy({
        by: ['availability'],
        where: { user: { role } },
        _count: true,
      }),
      this.driverKycStates(),
      this.prisma.user.count({
        where: { role, createdAt: { gte: new Date(Date.now() - 30 * day) } },
      }),
    ]);

    const status = tallyByStatus(byStatus);
    const availability = tallyByStatus(
      byAvailability.map((a) => ({ status: a.availability, _count: a._count })),
    );
    const available = availability[DriverAvailability.ONLINE] ?? 0;
    const onTrip = availability[DriverAvailability.ON_TRIP] ?? 0;

    let pendingKyc = 0;
    let approvedKyc = 0;
    let rejectedKyc = 0;
    for (const state of kycStates.values()) {
      if (state === 'PENDING') pendingKyc++;
      else if (state === 'REJECTED') rejectedKyc++;
      else approvedKyc++;
    }

    return {
      total: status.total,
      online: available + onTrip,
      available,
      onTrip,
      // A driver with no driver_statuses row has never gone online.
      offline: Math.max(0, status.total - available - onTrip),
      pendingKyc,
      approvedKyc,
      rejectedKyc,
      kycNotSubmitted: Math.max(0, status.total - kycStates.size),
      active: status[UserStatus.ACTIVE] ?? 0,
      suspended: status[UserStatus.SUSPENDED] ?? 0,
      pendingVerification: status[UserStatus.PENDING_VERIFICATION] ?? 0,
      newLast30Days,
    };
  }

  /**
   * KYC review state per driver, from the LATEST document of each type (a
   * resubmission supersedes an earlier rejection). PENDING wins over
   * REJECTED wins over APPROVED — a driver with anything awaiting review is
   * "pending" so it shows up in the admin's review queue. Drivers with no
   * documents are absent from the map (= NOT_SUBMITTED).
   */
  private async driverKycStates(): Promise<Map<string, 'PENDING' | 'APPROVED' | 'REJECTED'>> {
    const rows = await this.prisma.$queryRaw<Array<{ driverId: string; kycStatus: string }>>`
      WITH latest AS (
        SELECT DISTINCT ON ("driverId", "type") "driverId", "status"::text AS "status"
        FROM "kyc_documents"
        ORDER BY "driverId", "type", "createdAt" DESC
      )
      SELECT "driverId",
        CASE
          WHEN bool_or("status" = 'PENDING') THEN 'PENDING'
          WHEN bool_or("status" = 'REJECTED') THEN 'REJECTED'
          ELSE 'APPROVED'
        END AS "kycStatus"
      FROM latest
      GROUP BY "driverId"`;
    return new Map(
      rows.map((r) => [r.driverId, r.kycStatus as 'PENDING' | 'APPROVED' | 'REJECTED']),
    );
  }

  private async riderRows(where: Prisma.UserWhereInput, take: number, skip: number) {
    const riders = await this.prisma.user.findMany({
      where,
      select: USER_SUMMARY_SELECT,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });

    const ids = riders.map((r) => r.id);
    if (ids.length === 0) {
      return [];
    }

    const [rideStats, deliveryStats, wallets] = await Promise.all([
      this.prisma.ride.groupBy({
        by: ['riderId'],
        where: { riderId: { in: ids }, status: SETTLED_RIDE_STATUS },
        _count: true,
      }),
      this.prisma.delivery.groupBy({
        by: ['senderId'],
        where: { senderId: { in: ids }, status: SETTLED_DELIVERY_STATUS },
        _count: true,
      }),
      this.prisma.account.findMany({
        where: { ownerId: { in: ids }, type: AccountType.RIDER_WALLET },
        select: { ownerId: true, balance: true },
      }),
    ]);

    const tripsById = new Map(rideStats.map((r) => [r.riderId, r._count]));
    const deliveriesById = new Map(deliveryStats.map((d) => [d.senderId, d._count]));
    const balanceById = new Map(wallets.map((w) => [w.ownerId, w.balance]));

    return riders.map((rider) => ({
      ...rider,
      walletBalance: decimalToFixed(balanceById.get(rider.id)),
      totalTrips: tripsById.get(rider.id) ?? 0,
      totalDeliveries: deliveriesById.get(rider.id) ?? 0,
    }));
  }

  private async driverRows(where: Prisma.UserWhereInput, take: number, skip: number) {
    const drivers = await this.prisma.user.findMany({
      where,
      select: {
        ...USER_SUMMARY_SELECT,
        driverStatus: { select: { availability: true, serviceMode: true, vehicleType: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });

    const ids = drivers.map((d) => d.id);
    if (ids.length === 0) {
      return [];
    }

    const [rideStats, deliveryStats, kycStates] = await Promise.all([
      this.prisma.ride.groupBy({
        by: ['driverId'],
        where: { driverId: { in: ids }, status: SETTLED_RIDE_STATUS },
        _count: true,
        _sum: { finalFare: true, commissionAmount: true },
      }),
      this.prisma.delivery.groupBy({
        by: ['driverId'],
        where: { driverId: { in: ids }, status: SETTLED_DELIVERY_STATUS },
        _count: true,
        _sum: { finalFare: true, commissionAmount: true },
      }),
      this.driverKycStates(),
    ]);

    const rideById = new Map(rideStats.map((r) => [r.driverId, r]));
    const deliveryById = new Map(deliveryStats.map((d) => [d.driverId, d]));

    return drivers.map((driver) => {
      const rides = rideById.get(driver.id);
      const deliveries = deliveryById.get(driver.id);
      const grossFare = (rides?._sum.finalFare ?? new Prisma.Decimal(0)).plus(
        deliveries?._sum.finalFare ?? new Prisma.Decimal(0),
      );
      const commission = (rides?._sum.commissionAmount ?? new Prisma.Decimal(0)).plus(
        deliveries?._sum.commissionAmount ?? new Prisma.Decimal(0),
      );

      return {
        ...driver,
        // Flattened alongside the nested driverStatus object for the
        // admin table, which reads these off the top level.
        availability: driver.driverStatus?.availability ?? DriverAvailability.OFFLINE,
        vehicleType: driver.driverStatus?.vehicleType ?? null,
        serviceMode: driver.driverStatus?.serviceMode ?? null,
        kycStatus: kycStates.get(driver.id) ?? 'NOT_SUBMITTED',
        totalTrips: (rides?._count ?? 0) + (deliveries?._count ?? 0),
        totalEarnings: decimalToFixed(grossFare.minus(commission)),
        totalCommission: decimalToFixed(commission),
      };
    });
  }

  private userListWhere(role: UserRole, query: ListUsersQueryDto): Prisma.UserWhereInput {
    const createdAt = dateFilter(query.from, query.to);
    return {
      role,
      ...(query.status ? { status: query.status } : {}),
      ...(createdAt ? { createdAt } : {}),
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

  private async driverListWhere(
    query: Pick<
      ListDriversQueryDto,
      'search' | 'status' | 'from' | 'to' | 'availability' | 'kycStatus'
    >,
  ): Promise<Prisma.UserWhereInput> {
    const and: Prisma.UserWhereInput[] = [this.userListWhere(UserRole.DRIVER, query)];

    if (query.availability) {
      // No driver_statuses row means the driver has never gone online, i.e. OFFLINE.
      and.push(
        query.availability === DriverAvailability.OFFLINE
          ? {
              OR: [
                { driverStatus: { is: null } },
                { driverStatus: { availability: DriverAvailability.OFFLINE } },
              ],
            }
          : { driverStatus: { availability: query.availability } },
      );
    }

    if (query.kycStatus === 'NOT_SUBMITTED') {
      and.push({ kycDocuments: { none: {} } });
    } else if (query.kycStatus) {
      const states = await this.driverKycStates();
      const ids = [...states].filter(([, s]) => s === query.kycStatus).map(([id]) => id);
      and.push({ id: { in: ids } });
    }

    return { AND: and };
  }

  // ── Exports ───────────────────────────────────────────────────────────

  async exportRiders(query: ExportUsersQueryDto, actorId: string): Promise<ExportDocument> {
    const where = this.userListWhere(UserRole.RIDER, query);
    const [rows, total, summary, generatedBy] = await Promise.all([
      this.riderRows(where, EXPORT_MAX_ROWS, 0),
      this.prisma.user.count({ where }),
      this.riderSummary(),
      resolveActorName(this.prisma, actorId),
    ]);

    return {
      title: 'Riders Report',
      subtitle: 'Registered riders with wallet balance and trip activity',
      generatedBy,
      period: periodOf(query),
      filters: describeFilters({ Search: query.search, 'Account status': query.status }),
      summary: [
        {
          label: 'Total riders',
          value: summary.total,
          format: 'integer',
          note: 'Every user with the rider role.',
        },
        {
          label: 'Active',
          value: summary.active,
          format: 'integer',
          tone: 'good',
          note: 'Account status ACTIVE.',
        },
        {
          label: 'Pending verification',
          value: summary.pendingVerification,
          format: 'integer',
          tone: 'warn',
          note: 'Signed up but have not completed verification.',
        },
        {
          label: 'Suspended',
          value: summary.suspended,
          format: 'integer',
          tone: 'bad',
          note: 'Account status SUSPENDED.',
        },
        {
          label: 'New in last 7 days',
          value: summary.newLast7Days,
          format: 'integer',
          note: 'Riders registered in the trailing 7 days.',
        },
        {
          label: 'New in last 30 days',
          value: summary.newLast30Days,
          format: 'integer',
          note: 'Riders registered in the trailing 30 days.',
        },
        {
          label: 'Total wallet balance',
          value: summary.totalWalletBalance,
          format: 'currency',
          tone: 'info',
          note: 'Sum of every rider wallet balance.',
        },
        {
          label: 'Records in this export',
          value: total,
          format: 'integer',
          note: 'Riders matching the filters above (the cards above are platform-wide).',
        },
      ],
      sections: [
        {
          name: 'Riders',
          title: 'Riders',
          description: 'One row per rider, newest registrations first.',
          truncatedFrom: total > rows.length ? total : undefined,
          columns: [
            { key: 'name', header: 'Name', width: 26 },
            { key: 'email', header: 'Email', width: 30 },
            { key: 'phone', header: 'Phone', width: 16 },
            { key: 'status', header: 'Account status', format: 'status' },
            { key: 'totalTrips', header: 'Completed rides', format: 'integer', total: true },
            {
              key: 'totalDeliveries',
              header: 'Completed deliveries',
              format: 'integer',
              total: true,
            },
            { key: 'walletBalance', header: 'Wallet balance', format: 'currency', total: true },
            { key: 'createdAt', header: 'Registered', format: 'date' },
          ],
          rows: rows.map((r) => ({ ...r, name: fullName(r) })),
        },
      ],
    };
  }

  async exportDrivers(query: ExportDriversQueryDto, actorId: string): Promise<ExportDocument> {
    const where = await this.driverListWhere(query);
    const [rows, total, summary, generatedBy] = await Promise.all([
      this.driverRows(where, EXPORT_MAX_ROWS, 0),
      this.prisma.user.count({ where }),
      this.driverSummary(),
      resolveActorName(this.prisma, actorId),
    ]);

    return {
      title: 'Drivers Report',
      subtitle: 'Registered drivers with KYC status, availability and lifetime earnings',
      generatedBy,
      period: periodOf(query),
      filters: describeFilters({
        Search: query.search,
        'Account status': query.status,
        Availability: query.availability,
        'KYC status': query.kycStatus,
      }),
      summary: [
        {
          label: 'Total drivers',
          value: summary.total,
          format: 'integer',
          note: 'Every user with the driver role.',
        },
        {
          label: 'Online now',
          value: summary.online,
          format: 'integer',
          tone: 'good',
          note: 'Availability is ONLINE (waiting for a job) or ON_TRIP.',
        },
        {
          label: 'Pending KYC',
          value: summary.pendingKyc,
          format: 'integer',
          tone: 'warn',
          note: 'Drivers with at least one document awaiting admin review.',
        },
        {
          label: 'KYC approved',
          value: summary.approvedKyc,
          format: 'integer',
          tone: 'good',
          note: 'Latest document of every type approved.',
        },
        {
          label: 'KYC rejected',
          value: summary.rejectedKyc,
          format: 'integer',
          tone: 'bad',
          note: 'Nothing pending, at least one document rejected.',
        },
        {
          label: 'KYC not submitted',
          value: summary.kycNotSubmitted,
          format: 'integer',
          note: 'No documents uploaded yet.',
        },
        {
          label: 'On a trip',
          value: summary.onTrip,
          format: 'integer',
          tone: 'info',
          note: 'Currently on a ride or delivery.',
        },
        {
          label: 'Suspended',
          value: summary.suspended,
          format: 'integer',
          tone: 'bad',
          note: 'Account status SUSPENDED.',
        },
        {
          label: 'New in last 30 days',
          value: summary.newLast30Days,
          format: 'integer',
          note: 'Drivers registered in the trailing 30 days.',
        },
        {
          label: 'Records in this export',
          value: total,
          format: 'integer',
          note: 'Drivers matching the filters above (the cards above are platform-wide).',
        },
      ],
      sections: [
        {
          name: 'Drivers',
          title: 'Drivers',
          description:
            'One row per driver, newest registrations first. Earnings are net of commission, over completed rides and deliveries.',
          truncatedFrom: total > rows.length ? total : undefined,
          columns: [
            { key: 'name', header: 'Name', width: 26 },
            { key: 'phone', header: 'Phone', width: 16 },
            { key: 'email', header: 'Email', width: 30 },
            { key: 'status', header: 'Account status', format: 'status' },
            { key: 'kycStatus', header: 'KYC', format: 'status' },
            { key: 'availability', header: 'Availability', format: 'status' },
            { key: 'vehicleType', header: 'Vehicle', width: 14 },
            { key: 'totalTrips', header: 'Completed trips', format: 'integer', total: true },
            { key: 'totalEarnings', header: 'Net earnings', format: 'currency', total: true },
            { key: 'totalCommission', header: 'Commission', format: 'currency', total: true },
            { key: 'createdAt', header: 'Registered', format: 'date' },
          ],
          rows: rows.map((r) => ({ ...r, name: fullName(r) })),
        },
      ],
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

  // Every history route returns the standard { data, total, page, ... }
  // envelope plus a `summary` over the user's WHOLE history (not just the
  // page), so the detail drawer can show totals next to a paginated table.

  async getRiderRides(id: string, take: number, skip: number) {
    await this.assertRole(id, UserRole.RIDER);
    return this.rideHistory({ riderId: id }, 'rider', take, skip);
  }

  async getRiderDeliveries(id: string, take: number, skip: number) {
    await this.assertRole(id, UserRole.RIDER);
    return this.deliveryHistory({ senderId: id }, 'rider', take, skip);
  }

  async getDriverRides(id: string, take: number, skip: number) {
    await this.assertRole(id, UserRole.DRIVER);
    return this.rideHistory({ driverId: id }, 'driver', take, skip);
  }

  async getDriverDeliveries(id: string, take: number, skip: number) {
    await this.assertRole(id, UserRole.DRIVER);
    return this.deliveryHistory({ driverId: id }, 'driver', take, skip);
  }

  async getDriverWithdrawals(id: string, take: number, skip: number) {
    await this.assertRole(id, UserRole.DRIVER);
    const where: Prisma.WithdrawalRequestWhereInput = { driverId: id };
    const [data, total, byStatus] = await Promise.all([
      this.prisma.withdrawalRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.withdrawalRequest.count({ where }),
      this.prisma.withdrawalRequest.groupBy({
        by: ['status'],
        where,
        _count: true,
        _sum: { amount: true, settledCommission: true },
      }),
    ]);

    const amountOf = (status: TransactionStatus) =>
      byStatus.find((r) => r.status === status)?._sum.amount;
    const countOf = (status: TransactionStatus) =>
      byStatus.find((r) => r.status === status)?._count ?? 0;

    return toPaginated(
      data,
      total,
      { take, skip },
      {
        total,
        pending: countOf(TransactionStatus.PENDING),
        completed: countOf(TransactionStatus.COMPLETED),
        failed: countOf(TransactionStatus.FAILED),
        totalWithdrawn: decimalToFixed(amountOf(TransactionStatus.COMPLETED)),
        pendingAmount: decimalToFixed(amountOf(TransactionStatus.PENDING)),
        commissionSettled: decimalToFixed(
          byStatus.find((r) => r.status === TransactionStatus.COMPLETED)?._sum.settledCommission,
        ),
      },
    );
  }

  // Every wallet Transaction that touched any account this user owns
  // (rider wallet, or driver wallet + commission-payable), newest first.
  async getUserTransactions(id: string, take: number, skip: number) {
    const accounts = await this.prisma.account.findMany({
      where: { ownerId: id },
      select: { id: true },
    });
    const accountIds = accounts.map((a) => a.id);
    const where: Prisma.TransactionWhereInput = {
      entries: { some: { accountId: { in: accountIds } } },
    };
    if (accountIds.length === 0) {
      return toPaginated([], 0, { take, skip }, { total: 0, completed: 0, pending: 0, failed: 0 });
    }

    const [data, total, byStatus] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: { entries: { where: { accountId: { in: accountIds } } } },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.groupBy({ by: ['status'], where, _count: true }),
    ]);
    const counts = tallyByStatus(byStatus);
    return toPaginated(
      data,
      total,
      { take, skip },
      {
        total,
        completed: counts[TransactionStatus.COMPLETED] ?? 0,
        pending: counts[TransactionStatus.PENDING] ?? 0,
        failed: counts[TransactionStatus.FAILED] ?? 0,
      },
    );
  }

  private async rideHistory(
    where: Prisma.RideWhereInput,
    party: 'rider' | 'driver',
    take: number,
    skip: number,
  ) {
    const [data, total, byStatus, settled] = await Promise.all([
      this.prisma.ride.findMany({
        where,
        select: RIDE_LIST_SELECT,
        orderBy: { requestedAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.ride.count({ where }),
      this.prisma.ride.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.ride.aggregate({
        where: { ...where, status: SETTLED_RIDE_STATUS },
        _sum: { finalFare: true, commissionAmount: true },
      }),
    ]);
    return toPaginated(
      data,
      total,
      { take, skip },
      historySummary(party, total, byStatus, settled._sum),
    );
  }

  private async deliveryHistory(
    where: Prisma.DeliveryWhereInput,
    party: 'rider' | 'driver',
    take: number,
    skip: number,
  ) {
    const [data, total, byStatus, settled] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        select: DELIVERY_LIST_SELECT,
        orderBy: { requestedAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.delivery.count({ where }),
      this.prisma.delivery.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.delivery.aggregate({
        where: { ...where, status: SETTLED_DELIVERY_STATUS },
        _sum: { finalFare: true, commissionAmount: true },
      }),
    ]);
    return toPaginated(
      data,
      total,
      { take, skip },
      historySummary(party, total, byStatus, settled._sum),
    );
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

  async exportAuditLogs(query: ExportAuditQueryDto, exportedById: string): Promise<ExportDocument> {
    const [{ data, total }, generatedBy] = await Promise.all([
      this.audit.list(
        {
          action: query.action,
          targetType: query.targetType,
          actorId: query.actorId,
          from: query.from,
          to: query.to,
        },
        EXPORT_MAX_ROWS,
        0,
      ),
      resolveActorName(this.prisma, exportedById),
    ]);

    const actorIds = [...new Set(data.map((d) => d.actorId).filter((id): id is string => !!id))];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const actorName = new Map(actors.map((a) => [a.id, fullName(a) || a.email || a.id]));

    return {
      title: 'Audit Log',
      subtitle: 'Administrative actions recorded on the platform',
      generatedBy,
      period: periodOf(query),
      filters: describeFilters({
        Action: query.action,
        'Target type': query.targetType,
        Actor: query.actorId ? (actorName.get(query.actorId) ?? query.actorId) : undefined,
      }),
      summary: [
        {
          label: 'Events',
          value: total,
          format: 'integer',
          note: 'Audit events matching the filters.',
        },
        {
          label: 'Distinct actors',
          value: actorIds.length,
          format: 'integer',
          note: 'Different people who performed those actions.',
        },
        {
          label: 'Distinct actions',
          value: new Set(data.map((d) => d.action)).size,
          format: 'integer',
          note: 'Different action types in the result.',
        },
      ],
      sections: [
        {
          name: 'Audit log',
          description: 'One row per recorded action, newest first.',
          truncatedFrom: total > data.length ? total : undefined,
          columns: [
            { key: 'createdAt', header: 'When', format: 'datetime' },
            { key: 'actor', header: 'Actor', width: 26 },
            { key: 'action', header: 'Action', width: 28 },
            { key: 'targetType', header: 'Target type', width: 16 },
            { key: 'targetId', header: 'Target ID', width: 38 },
            { key: 'details', header: 'Details', width: 40 },
          ],
          rows: data.map((d) => ({
            ...d,
            actor: d.actorId ? (actorName.get(d.actorId) ?? d.actorId) : 'System',
            details: d.metadata ? JSON.stringify(d.metadata).slice(0, 300) : '',
          })),
        },
      ],
    };
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
