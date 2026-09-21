import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BatterySwapStation, BatterySwapStationStatus } from '@prisma/client';
import { haversineDistanceKm } from '../common/utils/haversine.util';
import { toPaginated } from '../common/utils/paginate.util';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

// Admin dashboard payload — accepts the doc's field names.
interface AdminBatterySwapStationInput {
  name: string;
  location: string;
  latitude: number;
  longitude: number;
  totalBays: number;
  availableBays: number;
  status?: BatterySwapStationStatus;
  pricePerSwap?: number;
  isActive?: boolean;
}

// Storage columns → dashboard-facing shape.
export function toSwapStationView(s: BatterySwapStation) {
  return {
    ...s,
    location: s.address,
    latitude: s.lat,
    longitude: s.lng,
    totalBays: s.totalSlots,
    availableBays: s.availableBatteries,
  };
}

// Heuristic only — this codebase doesn't track a real queue, so "wait
// time" is a flat estimate based on whether the station currently has any
// available battery, not a live per-station queue simulation.
const OCCUPIED_WAIT_MINUTES = 15;

@Injectable()
export class BatterySwapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async searchNearby(params: { lat: number; lng: number; radiusKm: number }) {
    const stations = await this.prisma.batterySwapStation.findMany({ where: { isActive: true } });

    return stations
      .map((station) => ({
        ...station,
        distanceKm: haversineDistanceKm(params.lat, params.lng, station.lat, station.lng),
        estimatedWaitMinutes: station.availableBatteries > 0 ? 0 : OCCUPIED_WAIT_MINUTES,
      }))
      .filter((station) => station.distanceKm <= params.radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  // Reservation and payment happen together — the plan's endpoint table
  // has no separate confirm step, so "reserve" means "pay and hold a slot"
  // in one action.
  async reserve(userId: string, stationId: string) {
    const station = await this.prisma.batterySwapStation.findUnique({ where: { id: stationId } });
    if (!station || !station.isActive) {
      throw new NotFoundException('Battery swap station not found');
    }

    // Atomic conditional decrement — same pattern as the wallet's balance
    // guard (WHERE availableBatteries > 0), so two concurrent reservations
    // can't both claim the last battery.
    const claimed = await this.prisma.batterySwapStation.updateMany({
      where: { id: stationId, availableBatteries: { gt: 0 } },
      data: { availableBatteries: { decrement: 1 } },
    });
    if (claimed.count === 0) {
      throw new ConflictException('No batteries currently available at this station');
    }

    const reference = `battery-swap:${userId}:${stationId}:${Date.now()}`;
    let reservation;
    try {
      const tx = await this.wallet.payForKilowattService(userId, station.pricePerSwap, reference);
      reservation = await this.prisma.batterySwapReservation.create({
        data: { userId, stationId, amount: station.pricePerSwap, transactionId: tx.id },
      });
    } catch (err) {
      // Payment failed (e.g. insufficient balance) — release the battery
      // back rather than stranding it as permanently claimed.
      await this.prisma.batterySwapStation.update({
        where: { id: stationId },
        data: { availableBatteries: { increment: 1 } },
      });
      throw err;
    }

    return reservation;
  }

  async getReservation(userId: string, id: string) {
    const reservation = await this.prisma.batterySwapReservation.findUnique({ where: { id } });
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }
    if (reservation.userId !== userId) {
      throw new ForbiddenException('You are not a participant on this reservation');
    }
    return reservation;
  }

  async listAllReservations(take = 50, skip = 0) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.batterySwapReservation.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.batterySwapReservation.count(),
    ]);
    return toPaginated(data, total, { take, skip });
  }

  // Not in the plan's endpoint table — but swap stations have to be
  // creatable/manageable somehow, and only charging stations got explicit
  // admin CRUD there. Mirrors ChargingStationsService's shape exactly.
  async listAllStations() {
    const stations = await this.prisma.batterySwapStation.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return stations.map(toSwapStationView);
  }

  async createStation(dto: AdminBatterySwapStationInput) {
    const station = await this.prisma.batterySwapStation.create({
      data: {
        name: dto.name,
        address: dto.location,
        lat: dto.latitude,
        lng: dto.longitude,
        totalSlots: dto.totalBays,
        availableBatteries: dto.availableBays,
        pricePerSwap: dto.pricePerSwap ?? 0,
        status: dto.status ?? BatterySwapStationStatus.AVAILABLE,
      },
    });
    return toSwapStationView(station);
  }

  async updateStation(id: string, dto: Partial<AdminBatterySwapStationInput>) {
    const existing = await this.prisma.batterySwapStation.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Battery swap station not found');
    }
    const station = await this.prisma.batterySwapStation.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.location !== undefined ? { address: dto.location } : {}),
        ...(dto.latitude !== undefined ? { lat: dto.latitude } : {}),
        ...(dto.longitude !== undefined ? { lng: dto.longitude } : {}),
        ...(dto.totalBays !== undefined ? { totalSlots: dto.totalBays } : {}),
        ...(dto.availableBays !== undefined ? { availableBatteries: dto.availableBays } : {}),
        ...(dto.pricePerSwap !== undefined ? { pricePerSwap: dto.pricePerSwap } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    return toSwapStationView(station);
  }

  // Soft delete — a station may be referenced by past reservations.
  async deleteStation(id: string) {
    const existing = await this.prisma.batterySwapStation.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Battery swap station not found');
    }
    await this.prisma.batterySwapStation.update({ where: { id }, data: { isActive: false } });
    return { deleted: true };
  }
}
