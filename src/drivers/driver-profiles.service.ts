import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryStatus, Prisma, RideStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertDriverVehicleDto } from './dto/driver-vehicle.dto';

export interface DriverVehicleSummary {
  make: string;
  model: string;
  color: string;
  plateNumber: string;
  photoUrl: string | null;
}

// What a rider sees about their driver: enough to recognise the person and
// the car at pickup ("Toyota Camry · LND 234 KJ · Silver", 4.9 ★, 20
// trips). Phone is included because the rider app offers "Call driver";
// only ever returned to a participant on that trip.
export interface DriverCard {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  profilePhotoUrl: string | null;
  rating: number | null; // null until the driver has a first rating
  ratingCount: number;
  tripCount: number; // completed rides + deliveries
  vehicle: DriverVehicleSummary | null;
}

@Injectable()
export class DriverProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  getVehicle(driverId: string) {
    return this.prisma.driverVehicle.findUnique({ where: { driverId } });
  }

  async upsertVehicle(driverId: string, dto: UpsertDriverVehicleDto) {
    const plateOwner = await this.prisma.driverVehicle.findUnique({
      where: { plateNumber: dto.plateNumber },
    });
    if (plateOwner && plateOwner.driverId !== driverId) {
      throw new ConflictException('This plate number is registered to another driver');
    }
    const data = {
      make: dto.make.trim(),
      model: dto.model.trim(),
      color: dto.color.trim(),
      plateNumber: dto.plateNumber,
      year: dto.year ?? null,
      photoUrl: dto.photoUrl ?? null,
    };
    return this.prisma.driverVehicle.upsert({
      where: { driverId },
      update: data,
      create: { driverId, ...data },
    });
  }

  async getDriverCard(driverId: string): Promise<DriverCard> {
    const cards = await this.getDriverCards([driverId]);
    const card = cards.get(driverId);
    if (!card) {
      throw new NotFoundException('Driver not found');
    }
    return card;
  }

  // Batched so list screens (activity, reviews) make three queries total,
  // not three per row.
  async getDriverCards(driverIds: string[]): Promise<Map<string, DriverCard>> {
    const ids = [...new Set(driverIds)];
    if (ids.length === 0) {
      return new Map();
    }

    const [drivers, ratings, rideCounts, deliveryCounts] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          profilePhotoUrl: true,
          driverVehicle: {
            select: { make: true, model: true, color: true, plateNumber: true, photoUrl: true },
          },
        },
      }),
      // RideRating has no driverId of its own — join through rides.
      this.prisma.$queryRaw<Array<{ driverId: string; avg: number; count: bigint }>>`
        SELECT r."driverId", AVG(rr."rating")::float AS "avg", COUNT(*) AS "count"
        FROM "ride_ratings" rr
        JOIN "rides" r ON r."id" = rr."rideId"
        WHERE r."driverId" IN (${Prisma.join(ids)})
        GROUP BY r."driverId"`,
      this.prisma.ride.groupBy({
        by: ['driverId'],
        where: { driverId: { in: ids }, status: RideStatus.COMPLETED },
        _count: true,
      }),
      this.prisma.delivery.groupBy({
        by: ['driverId'],
        where: { driverId: { in: ids }, status: DeliveryStatus.COMPLETED },
        _count: true,
      }),
    ]);

    const ratingBy = new Map(ratings.map((r) => [r.driverId, r]));
    const ridesBy = new Map(rideCounts.map((r) => [r.driverId, r._count]));
    const deliveriesBy = new Map(deliveryCounts.map((d) => [d.driverId, d._count]));

    return new Map(
      drivers.map((d) => {
        const rating = ratingBy.get(d.id);
        return [
          d.id,
          {
            id: d.id,
            firstName: d.firstName,
            lastName: d.lastName,
            phone: d.phone,
            profilePhotoUrl: d.profilePhotoUrl,
            // One decimal place, as displayed ("4.9").
            rating: rating ? Math.round(rating.avg * 10) / 10 : null,
            ratingCount: rating ? Number(rating.count) : 0,
            tripCount: (ridesBy.get(d.id) ?? 0) + (deliveriesBy.get(d.id) ?? 0),
            vehicle: d.driverVehicle,
          },
        ];
      }),
    );
  }
}
