import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AnalyticsRange,
  BucketUnit,
  buildBuckets,
  rangeMeta,
  rangeWindow,
  truncExpr,
} from '../common/utils/time-bucket.util';

export interface SeriesBucket {
  label: string;
  start: Date;
  rides: number;
  deliveries: number;
}

export interface GrowthBucket {
  label: string;
  start: Date;
  drivers: number;
  riders: number;
}

interface GroupedRow {
  bucket: string | null;
  value: number;
}

// Time-series aggregates behind the dashboard's "Platform Analytics" card.
// One grouped SQL query per series, folded onto a zero-filled bucket
// skeleton (see time-bucket.util) so the response is a fixed shape
// regardless of how sparse the underlying data is.
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async platformAnalytics(range: AnalyticsRange) {
    const { unit, periodLabel } = rangeMeta(range);
    const { from, to } = rangeWindow(range);

    const [rideTrips, deliveryTrips, rideRevenue, deliveryRevenue, growth] = await Promise.all([
      this.countByBucket('rides', 'requestedAt', unit, from, to),
      this.countByBucket('deliveries', 'requestedAt', unit, from, to),
      this.sumByBucket('rides', 'completedAt', 'commissionAmount', unit, from, to),
      this.sumByBucket('deliveries', 'completedAt', 'commissionAmount', unit, from, to),
      this.userGrowth(range, unit, from, to),
    ]);

    const skeleton = buildBuckets(range);
    const pair = (a: Map<string, number>, b: Map<string, number>): SeriesBucket[] =>
      skeleton.map((s) => ({
        label: s.label,
        start: s.start,
        rides: a.get(s.key) ?? 0,
        deliveries: b.get(s.key) ?? 0,
      }));

    return {
      range,
      periodLabel,
      trips: pair(toMap(rideTrips), toMap(deliveryTrips)),
      revenue: pair(toMap(rideRevenue), toMap(deliveryRevenue)),
      growth,
    };
  }

  // ── grouped-query helpers ───────────────────────────────────────────

  private countByBucket(
    table: 'rides' | 'deliveries',
    dateColumn: string,
    unit: BucketUnit,
    from: Date,
    to: Date,
  ): Promise<GroupedRow[]> {
    const bucketExpr = Prisma.raw(truncExpr(unit, `"${dateColumn}"`));
    const tbl = Prisma.raw(`"${table}"`);
    const col = Prisma.raw(`"${dateColumn}"`);
    return this.prisma.$queryRaw<GroupedRow[]>`
      SELECT ${bucketExpr} AS bucket, COUNT(*)::int AS value
      FROM ${tbl}
      WHERE ${col} >= ${from} AND ${col} < ${to}
      GROUP BY 1
    `;
  }

  // SUM of a Decimal column over COMPLETED rows only — "revenue" here is the
  // platform's commission take, not gross fare volume.
  private sumByBucket(
    table: 'rides' | 'deliveries',
    dateColumn: string,
    sumColumn: string,
    unit: BucketUnit,
    from: Date,
    to: Date,
  ): Promise<GroupedRow[]> {
    const bucketExpr = Prisma.raw(truncExpr(unit, `"${dateColumn}"`));
    const tbl = Prisma.raw(`"${table}"`);
    const col = Prisma.raw(`"${dateColumn}"`);
    const sumCol = Prisma.raw(`"${sumColumn}"`);
    return this.prisma.$queryRaw<GroupedRow[]>`
      SELECT ${bucketExpr} AS bucket, COALESCE(SUM(${sumCol}), 0)::float8 AS value
      FROM ${tbl}
      WHERE ${col} >= ${from} AND ${col} < ${to} AND "status" = 'COMPLETED'
      GROUP BY 1
    `;
  }

  // Cumulative driver / rider totals at the END of each bucket: a baseline
  // count of everyone created before the window, plus per-bucket signups
  // accumulated forward.
  private async userGrowth(
    range: AnalyticsRange,
    unit: BucketUnit,
    from: Date,
    to: Date,
  ): Promise<GrowthBucket[]> {
    const bucketExpr = Prisma.raw(truncExpr(unit, '"createdAt"'));

    const [baseline, perBucket] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['role'],
        where: { role: { in: ['DRIVER', 'RIDER'] }, createdAt: { lt: from } },
        _count: true,
      }),
      this.prisma.$queryRaw<Array<{ bucket: string | null; role: string; value: number }>>`
        SELECT ${bucketExpr} AS bucket, "role"::text AS role, COUNT(*)::int AS value
        FROM "users"
        WHERE "role" IN ('DRIVER', 'RIDER') AND "createdAt" >= ${from} AND "createdAt" < ${to}
        GROUP BY 1, 2
      `,
    ]);

    let drivers = baseline.find((b) => b.role === 'DRIVER')?._count ?? 0;
    let riders = baseline.find((b) => b.role === 'RIDER')?._count ?? 0;

    const newDrivers = new Map<string, number>();
    const newRiders = new Map<string, number>();
    for (const row of perBucket) {
      if (!row.bucket) continue;
      (row.role === 'DRIVER' ? newDrivers : newRiders).set(row.bucket, Number(row.value) || 0);
    }

    return buildBuckets(range).map((b) => {
      drivers += newDrivers.get(b.key) ?? 0;
      riders += newRiders.get(b.key) ?? 0;
      return { label: b.label, start: b.start, drivers, riders };
    });
  }
}

function toMap(rows: GroupedRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.bucket) m.set(r.bucket, Number(r.value) || 0);
  }
  return m;
}
