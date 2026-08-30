import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountType,
  DriverAvailability,
  Prisma,
  RideStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WalletService } from '../wallet/wallet.service';

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
    const [
      riderCount,
      driverCount,
      onlineDriverCount,
      totalRides,
      completedRides,
      cancelledRides,
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
      this.wallet.getPlatformAccount(AccountType.PLATFORM_REVENUE),
    ]);

    return {
      riders: riderCount,
      drivers: driverCount,
      onlineDrivers: onlineDriverCount,
      rides: { total: totalRides, completed: completedRides, cancelled: cancelledRides },
      totalRevenue: platformRevenue.balance,
    };
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

  async listRiders(search: string | undefined, take: number, skip: number) {
    return this.listUsers(UserRole.RIDER, search, take, skip);
  }

  async listDrivers(search: string | undefined, take: number, skip: number) {
    return this.listUsers(UserRole.DRIVER, search, take, skip);
  }

  async getRiderDetail(id: string) {
    const user = await this.getUserOrThrow(id, UserRole.RIDER);
    const rideStats = await this.prisma.ride.groupBy({
      by: ['status'],
      where: { riderId: id },
      _count: true,
    });
    return { ...user, rides: Object.fromEntries(rideStats.map((r) => [r.status, r._count])) };
  }

  async getDriverDetail(id: string) {
    const user = await this.getUserOrThrow(id, UserRole.DRIVER);
    const [rideStats, driverStatus, commissionPayable] = await Promise.all([
      this.prisma.ride.groupBy({ by: ['status'], where: { driverId: id }, _count: true }),
      this.prisma.driverStatus.findUnique({ where: { userId: id } }),
      this.prisma.account.findUnique({
        where: { ownerId_type: { ownerId: id, type: AccountType.DRIVER_COMMISSION_PAYABLE } },
      }),
    ]);
    return {
      ...user,
      rides: Object.fromEntries(rideStats.map((r) => [r.status, r._count])),
      availability: driverStatus?.availability ?? DriverAvailability.OFFLINE,
      unsettledCashRideCount: driverStatus?.unsettledCashRideCount ?? 0,
      outstandingCommission: commissionPayable?.balance ?? 0,
    };
  }

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

  async getAuditLogs(take: number, skip: number) {
    return this.audit.list(take, skip);
  }

  private async listUsers(role: UserRole, search: string | undefined, take: number, skip: number) {
    return this.prisma.user.findMany({
      where: {
        role,
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: USER_SUMMARY_SELECT,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  private async getUserOrThrow(id: string, role: UserRole) {
    const user = await this.prisma.user.findFirst({
      where: { id, role },
      select: USER_SUMMARY_SELECT,
    });
    if (!user) {
      throw new NotFoundException(`${role === UserRole.RIDER ? 'Rider' : 'Driver'} not found`);
    }
    return user;
  }

  private async setUserStatus(id: string, status: UserStatus) {
    const result = await this.prisma.user.updateMany({
      where: { id, role: { in: [UserRole.RIDER, UserRole.DRIVER] } },
      data: { status },
    });
    if (result.count === 0) {
      throw new NotFoundException('User not found');
    }
    return this.prisma.user.findUniqueOrThrow({ where: { id }, select: USER_SUMMARY_SELECT });
  }
}
