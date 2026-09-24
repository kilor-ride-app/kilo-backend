import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SavedPlaceLabel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSavedPlaceDto, UpdateSavedPlaceDto } from './dto/saved-place.dto';

const RECENT_PLACES_LIMIT = 10;
// How far back to scan for recent destinations — enough history to fill
// the list after de-duplication without reading a user's whole archive.
const RECENT_SCAN_DEPTH = 40;

// HOME and WORK are singletons per user; OTHER is unlimited.
const SINGLETON_LABELS: SavedPlaceLabel[] = [SavedPlaceLabel.HOME, SavedPlaceLabel.WORK];

@Injectable()
export class SavedPlacesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.savedPlace.findMany({
      where: { userId },
      // HOME, WORK, then OTHER (enum order), newest first within a label.
      orderBy: [{ label: 'asc' }, { createdAt: 'desc' }],
    });
  }

  // Saving a second HOME/WORK replaces the first rather than erroring —
  // "set my home address" is what the user means either way.
  async create(userId: string, dto: CreateSavedPlaceDto) {
    this.assertNamed(dto.label, dto.name);
    const data = {
      label: dto.label,
      name: dto.label === SavedPlaceLabel.OTHER ? dto.name!.trim() : null,
      address: dto.address.trim(),
      lat: dto.lat,
      lng: dto.lng,
    };

    if (SINGLETON_LABELS.includes(dto.label)) {
      const existing = await this.prisma.savedPlace.findFirst({
        where: { userId, label: dto.label },
      });
      if (existing) {
        return this.prisma.savedPlace.update({ where: { id: existing.id }, data });
      }
    }
    return this.prisma.savedPlace.create({ data: { userId, ...data } });
  }

  async update(userId: string, id: string, dto: UpdateSavedPlaceDto) {
    const place = await this.findOwned(userId, id);
    const label = dto.label ?? place.label;
    const name = dto.name ?? place.name ?? undefined;
    this.assertNamed(label, name);

    if (label !== place.label && SINGLETON_LABELS.includes(label)) {
      // Relabelling onto HOME/WORK displaces whatever held that label.
      await this.prisma.savedPlace.deleteMany({ where: { userId, label, id: { not: id } } });
    }

    return this.prisma.savedPlace.update({
      where: { id },
      data: {
        label,
        name: label === SavedPlaceLabel.OTHER ? name!.trim() : null,
        ...(dto.address !== undefined ? { address: dto.address.trim() } : {}),
        ...(dto.lat !== undefined ? { lat: dto.lat } : {}),
        ...(dto.lng !== undefined ? { lng: dto.lng } : {}),
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.findOwned(userId, id);
    await this.prisma.savedPlace.delete({ where: { id } });
    return { deleted: true };
  }

  // Distinct recent destinations across rides and deliveries, newest
  // first — the "Recent Places" list on the home and where-to sheets.
  // Deduplicated on the normalized address string, since the same place
  // geocodes to slightly different coordinates from trip to trip.
  async recent(userId: string) {
    const [rides, stops] = await Promise.all([
      this.prisma.ride.findMany({
        where: { riderId: userId },
        orderBy: { requestedAt: 'desc' },
        take: RECENT_SCAN_DEPTH,
        select: { dropoffAddress: true, dropoffLat: true, dropoffLng: true, requestedAt: true },
      }),
      this.prisma.deliveryStop.findMany({
        where: { delivery: { senderId: userId } },
        orderBy: { delivery: { requestedAt: 'desc' } },
        take: RECENT_SCAN_DEPTH,
        select: {
          address: true,
          lat: true,
          lng: true,
          delivery: { select: { requestedAt: true } },
        },
      }),
    ]);

    const candidates = [
      ...rides.map((r) => ({
        address: r.dropoffAddress,
        lat: r.dropoffLat,
        lng: r.dropoffLng,
        lastUsedAt: r.requestedAt,
      })),
      ...stops.map((s) => ({
        address: s.address,
        lat: s.lat,
        lng: s.lng,
        lastUsedAt: s.delivery.requestedAt,
      })),
    ].sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime());

    const seen = new Set<string>();
    const recent: typeof candidates = [];
    for (const place of candidates) {
      const key = place.address.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      recent.push(place);
      if (recent.length === RECENT_PLACES_LIMIT) break;
    }
    return recent;
  }

  private assertNamed(label: SavedPlaceLabel, name?: string) {
    if (label === SavedPlaceLabel.OTHER && !name?.trim()) {
      throw new BadRequestException('A name is required for OTHER places');
    }
  }

  private async findOwned(userId: string, id: string) {
    const place = await this.prisma.savedPlace.findUnique({ where: { id } });
    if (!place || place.userId !== userId) {
      throw new NotFoundException('Saved place not found');
    }
    return place;
  }
}
