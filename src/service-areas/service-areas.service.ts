import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { isPointInPolygon } from './utils/point-in-polygon.util';

interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

interface ServiceAreaRecord {
  id: string;
  name: string;
  polygon: GeoJsonPolygon;
  isActive: boolean;
}

const ACTIVE_CACHE_KEY = 'service-areas:active';
const ACTIVE_CACHE_TTL_SECONDS = 60 * 60; // long TTL — invalidated explicitly on write, per plan.md Section 9

@Injectable()
export class ServiceAreasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async validateLocation(lat: number, lng: number) {
    const areas = await this.getActiveAreas();
    const match = areas.find((area) => isPointInPolygon([lng, lat], area.polygon.coordinates));

    return {
      isServiceable: !!match,
      serviceArea: match ? { id: match.id, name: match.name } : null,
    };
  }

  async list() {
    return this.prisma.serviceArea.findMany({ orderBy: { name: 'asc' } });
  }

  async create(dto: { name: string; polygon: GeoJsonPolygon; isActive?: boolean }) {
    const polygon = this.normalizePolygon(dto.polygon);
    const area = await this.prisma.serviceArea.create({
      data: {
        name: dto.name,
        polygon: polygon as unknown as Prisma.InputJsonValue,
        isActive: dto.isActive ?? true,
      },
    });
    await this.invalidateCache();
    return area;
  }

  async update(id: string, dto: { name?: string; polygon?: GeoJsonPolygon; isActive?: boolean }) {
    await this.findOrThrow(id);
    const area = await this.prisma.serviceArea.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.polygon !== undefined
          ? { polygon: this.normalizePolygon(dto.polygon) as unknown as Prisma.InputJsonValue }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.invalidateCache();
    return area;
  }

  async remove(id: string) {
    await this.findOrThrow(id);
    await this.prisma.serviceArea.delete({ where: { id } });
    await this.invalidateCache();
    return { message: 'Service area removed' };
  }

  private async findOrThrow(id: string) {
    const area = await this.prisma.serviceArea.findUnique({ where: { id } });
    if (!area) {
      throw new NotFoundException('Service area not found');
    }
    return area;
  }

  private async getActiveAreas(): Promise<ServiceAreaRecord[]> {
    const cached = await this.redis.getJson<ServiceAreaRecord[]>(ACTIVE_CACHE_KEY);
    if (cached) {
      return cached;
    }

    const areas = await this.prisma.serviceArea.findMany({
      where: { isActive: true },
      select: { id: true, name: true, polygon: true, isActive: true },
    });
    const records = areas as unknown as ServiceAreaRecord[];
    await this.redis.setJson(ACTIVE_CACHE_KEY, records, ACTIVE_CACHE_TTL_SECONDS);
    return records;
  }

  private async invalidateCache() {
    await this.redis.client.del(ACTIVE_CACHE_KEY);
  }

  // GeoJSON requires a closed ring (first point === last point) — auto-close
  // rather than reject, since drawing tools commonly omit the closing point.
  private normalizePolygon(polygon: GeoJsonPolygon): GeoJsonPolygon {
    const ring = polygon.coordinates[0];
    if (!ring || ring.length < 4) {
      throw new BadRequestException(
        'Polygon ring must have at least 4 points (3 unique + closing point)',
      );
    }

    const [firstLng, firstLat] = ring[0];
    const [lastLng, lastLat] = ring[ring.length - 1];
    const isClosed = firstLng === lastLng && firstLat === lastLat;

    return {
      type: 'Polygon',
      coordinates: [isClosed ? ring : [...ring, ring[0]]],
    };
  }
}
