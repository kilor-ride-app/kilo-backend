import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { haversineDistanceKm } from '../common/utils/haversine.util';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

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
    return this.prisma.batterySwapReservation.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  // Not in the plan's endpoint table — but swap stations have to be
  // creatable/manageable somehow, and only charging stations got explicit
  // admin CRUD there. Mirrors ChargingStationsService's shape exactly.
  async listAllStations() {
    return this.prisma.batterySwapStation.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createStation(dto: {
    name: string;
    address: string;
    lat: number;
    lng: number;
    totalSlots: number;
    availableBatteries: number;
    pricePerSwap: number;
  }) {
    return this.prisma.batterySwapStation.create({ data: dto });
  }

  async updateStation(
    id: string,
    dto: Partial<{
      name: string;
      address: string;
      lat: number;
      lng: number;
      totalSlots: number;
      availableBatteries: number;
      pricePerSwap: number;
      isActive: boolean;
    }>,
  ) {
    const station = await this.prisma.batterySwapStation.findUnique({ where: { id } });
    if (!station) {
      throw new NotFoundException('Battery swap station not found');
    }
    return this.prisma.batterySwapStation.update({ where: { id }, data: dto });
  }
}
