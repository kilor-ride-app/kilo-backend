import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountType, LedgerDirection, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FleetPartnersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: { name: string; contactEmail?: string; contactPhone?: string }) {
    return this.prisma.fleetPartner.create({ data: dto });
  }

  async list() {
    return this.prisma.fleetPartner.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getDetail(id: string) {
    const partner = await this.prisma.fleetPartner.findUnique({ where: { id } });
    if (!partner) {
      throw new NotFoundException('Fleet partner not found');
    }
    return partner;
  }

  async attachDriver(fleetPartnerId: string, driverId: string) {
    await this.getDetail(fleetPartnerId);
    const driver = await this.prisma.user.findUnique({ where: { id: driverId } });
    if (!driver || driver.role !== UserRole.DRIVER) {
      throw new BadRequestException('driverId must belong to an existing driver account');
    }
    const existing = await this.prisma.fleetPartnerDriver.findUnique({ where: { driverId } });
    if (existing) {
      throw new ConflictException('This driver is already attached to a fleet partner');
    }
    return this.prisma.fleetPartnerDriver.create({ data: { fleetPartnerId, driverId } });
  }

  async listDrivers(fleetPartnerId: string) {
    await this.getDetail(fleetPartnerId);
    return this.prisma.fleetPartnerDriver.findMany({
      where: { fleetPartnerId },
      include: {
        driver: {
          select: { id: true, publicId: true, firstName: true, lastName: true, phone: true },
        },
      },
    });
  }

  // Sums DRIVER_WALLET credit ledger entries for every driver attached to
  // this fleet — captures WALLET-paid ride/delivery earnings. Cash-paid
  // earnings never touch DRIVER_WALLET at all (the driver keeps the cash
  // directly, per this system's design — see WalletService.
  // recordCashRideCommission), so they aren't reflected here; a known
  // simplification, not an oversight.
  async getEarnings(fleetPartnerId: string, from: Date, to: Date) {
    await this.getDetail(fleetPartnerId);
    const attached = await this.prisma.fleetPartnerDriver.findMany({
      where: { fleetPartnerId },
      select: { driverId: true },
    });
    const driverIds = attached.map((d) => d.driverId);
    if (driverIds.length === 0) {
      return { driverCount: 0, totalEarnings: new Prisma.Decimal(0) };
    }

    const accounts = await this.prisma.account.findMany({
      where: { ownerId: { in: driverIds }, type: AccountType.DRIVER_WALLET },
      select: { id: true },
    });
    const agg = await this.prisma.ledgerEntry.aggregate({
      where: {
        accountId: { in: accounts.map((a) => a.id) },
        direction: LedgerDirection.CREDIT,
        createdAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
    });

    return {
      driverCount: driverIds.length,
      totalEarnings: agg._sum.amount ?? new Prisma.Decimal(0),
    };
  }
}
