import { Injectable, NotFoundException } from '@nestjs/common';
import { ChargingStationStatus } from '@prisma/client';
import { haversineDistanceKm } from '../common/utils/haversine.util';
import { PrismaService } from '../prisma/prisma.service';

interface ChargingStationInput {
  name: string;
  address: string;
  lat: number;
  lng: number;
  chargerTypes: string[];
  connectorCount: number;
  speedKw: number;
  pricePerKwh: number;
}

@Injectable()
export class ChargingStationsService {
  constructor(private readonly prisma: PrismaService) {}

  // Small, slow-changing dataset — filtered/sorted by distance in
  // application code rather than a DB geo query (same rationale as
  // ServiceAreasService's ray-casting).
  async searchNearby(params: {
    lat: number;
    lng: number;
    radiusKm: number;
    chargerType?: string;
    minSpeedKw?: number;
  }) {
    const stations = await this.prisma.chargingStation.findMany({
      where: {
        isActive: true,
        ...(params.chargerType ? { chargerTypes: { has: params.chargerType } } : {}),
        ...(params.minSpeedKw ? { speedKw: { gte: params.minSpeedKw } } : {}),
      },
    });

    return stations
      .map((station) => ({
        ...station,
        distanceKm: haversineDistanceKm(params.lat, params.lng, station.lat, station.lng),
      }))
      .filter((station) => station.distanceKm <= params.radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  async getStation(id: string) {
    const station = await this.prisma.chargingStation.findUnique({ where: { id } });
    if (!station) {
      throw new NotFoundException('Charging station not found');
    }
    return station;
  }

  async listAll() {
    return this.prisma.chargingStation.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createStation(dto: ChargingStationInput) {
    return this.prisma.chargingStation.create({ data: dto });
  }

  async updateStation(
    id: string,
    dto: Partial<ChargingStationInput> & { status?: ChargingStationStatus; isActive?: boolean },
  ) {
    await this.getStation(id);
    return this.prisma.chargingStation.update({ where: { id }, data: dto });
  }
}
