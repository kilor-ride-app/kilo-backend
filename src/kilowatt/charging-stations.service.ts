import { Injectable, NotFoundException } from '@nestjs/common';
import { ChargingStation, ChargingStationStatus } from '@prisma/client';
import { haversineDistanceKm } from '../common/utils/haversine.util';
import { PrismaService } from '../prisma/prisma.service';

// Admin dashboard payload — accepts the doc's field names.
interface AdminChargingStationInput {
  name: string;
  location: string;
  latitude: number;
  longitude: number;
  totalBays: number;
  availableBays?: number;
  status?: ChargingStationStatus;
  chargerTypes?: string[];
  speedKw?: number;
  pricePerKwh?: number;
  isActive?: boolean;
}

// Storage columns → dashboard-facing shape. Keeps the raw columns too so
// existing consumers don't break.
export function toChargingStationView(s: ChargingStation) {
  return {
    ...s,
    location: s.address,
    latitude: s.lat,
    longitude: s.lng,
    totalBays: s.connectorCount,
    availableBays: s.availableBays,
  };
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
    const stations = await this.prisma.chargingStation.findMany({ orderBy: { createdAt: 'desc' } });
    return stations.map(toChargingStationView);
  }

  async createStation(dto: AdminChargingStationInput) {
    const station = await this.prisma.chargingStation.create({
      data: {
        name: dto.name,
        address: dto.location,
        lat: dto.latitude,
        lng: dto.longitude,
        connectorCount: dto.totalBays,
        availableBays: dto.availableBays ?? dto.totalBays,
        chargerTypes: dto.chargerTypes ?? [],
        speedKw: dto.speedKw ?? 0,
        pricePerKwh: dto.pricePerKwh ?? 0,
        status: dto.status ?? ChargingStationStatus.AVAILABLE,
      },
    });
    return toChargingStationView(station);
  }

  async updateStation(id: string, dto: Partial<AdminChargingStationInput>) {
    await this.getStation(id);
    const station = await this.prisma.chargingStation.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.location !== undefined ? { address: dto.location } : {}),
        ...(dto.latitude !== undefined ? { lat: dto.latitude } : {}),
        ...(dto.longitude !== undefined ? { lng: dto.longitude } : {}),
        ...(dto.totalBays !== undefined ? { connectorCount: dto.totalBays } : {}),
        ...(dto.availableBays !== undefined ? { availableBays: dto.availableBays } : {}),
        ...(dto.chargerTypes !== undefined ? { chargerTypes: dto.chargerTypes } : {}),
        ...(dto.speedKw !== undefined ? { speedKw: dto.speedKw } : {}),
        ...(dto.pricePerKwh !== undefined ? { pricePerKwh: dto.pricePerKwh } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    return toChargingStationView(station);
  }

  // Soft delete — keeps the row (and any historical references) but hides
  // it from every list/search.
  async deleteStation(id: string) {
    await this.getStation(id);
    await this.prisma.chargingStation.update({ where: { id }, data: { isActive: false } });
    return { deleted: true };
  }
}
