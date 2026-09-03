// Shared time-bucketing for the admin dashboard's analytics charts
// (Platform Analytics, top-up trend). One place defines the five ranges the
// frontend offers, how coarse each one's buckets are, and the string key
// used to line up a grouped SQL aggregate against a zero-filled skeleton.
//
// Everything here is UTC. The DateTime columns are `TIMESTAMP(3)` (no zone,
// Prisma stores UTC), so `date_trunc(...)` in SQL and the `Date` UTC getters
// here operate in the same value space with no timezone conversion.

export type AnalyticsRange = 'day' | '7days' | 'month' | '6months' | 'year';

export type BucketUnit = 'hour' | 'day' | 'month';

export const ANALYTICS_RANGES: AnalyticsRange[] = ['day', '7days', 'month', '6months', 'year'];

interface RangeMeta {
  unit: BucketUnit;
  count: number;
  periodLabel: string;
}

const META: Record<AnalyticsRange, RangeMeta> = {
  day: { unit: 'hour', count: 24, periodLabel: 'Today (hourly)' },
  '7days': { unit: 'day', count: 7, periodLabel: 'Last 7 days' },
  month: { unit: 'day', count: 30, periodLabel: 'Last 30 days' },
  '6months': { unit: 'month', count: 6, periodLabel: 'Last 6 months' },
  year: { unit: 'month', count: 12, periodLabel: 'Last 12 months' },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface Bucket {
  /** inclusive lower bound, UTC */
  start: Date;
  /** exclusive upper bound, UTC */
  end: Date;
  /** short human label for the chart axis */
  label: string;
  /** matches the SQL `to_char(date_trunc(...))` key — see truncExpr() */
  key: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Midnight UTC at the start of the given day (default: today). */
export function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function rangeMeta(range: AnalyticsRange): RangeMeta {
  return META[range];
}

/** date_trunc + to_char expression producing a key that matches Bucket.key. */
export function truncExpr(unit: BucketUnit, column: string): string {
  const fmt =
    unit === 'hour' ? `'YYYY-MM-DD"T"HH24'` : unit === 'day' ? `'YYYY-MM-DD'` : `'YYYY-MM'`;
  return `to_char(date_trunc('${unit}', ${column}), ${fmt})`;
}

function keyFor(unit: BucketUnit, d: Date): string {
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  if (unit === 'month') return `${y}-${m}`;
  const day = pad(d.getUTCDate());
  if (unit === 'day') return `${y}-${m}-${day}`;
  return `${y}-${m}-${day}T${pad(d.getUTCHours())}`;
}

function labelFor(unit: BucketUnit, d: Date, includeYear: boolean): string {
  if (unit === 'hour') return `${pad(d.getUTCHours())}:00`;
  if (unit === 'day') return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}`;
  const base = MONTHS[d.getUTCMonth()];
  return includeYear ? `${base} ${String(d.getUTCFullYear()).slice(2)}` : base;
}

/**
 * The zero-fill target: a fixed-length list of consecutive buckets ending at
 * "now" (the current hour / day / month), oldest first.
 */
export function buildBuckets(range: AnalyticsRange, now: Date = new Date()): Bucket[] {
  const { unit, count } = META[range];
  const buckets: Bucket[] = [];

  if (unit === 'month') {
    // Anchor on the first of the current month, walk back count-1 months.
    const startMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1), 1));
    for (let i = 0; i < count; i++) {
      const start = new Date(
        Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + i, 1),
      );
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      buckets.push({
        start,
        end,
        key: keyFor(unit, start),
        label: labelFor(unit, start, range === 'year'),
      });
    }
    return buckets;
  }

  const stepMs = unit === 'hour' ? 3_600_000 : 86_400_000;
  // Anchor: start of the current hour (for 'day', start of today) / start of today.
  const anchor =
    unit === 'hour'
      ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (count - 1) * stepMs;

  for (let i = 0; i < count; i++) {
    const start = new Date(anchor + i * stepMs);
    const end = new Date(anchor + (i + 1) * stepMs);
    buckets.push({ start, end, key: keyFor(unit, start), label: labelFor(unit, start, false) });
  }
  return buckets;
}

/** [from, to) covering the whole bucket list — for the SQL WHERE clause. */
export function rangeWindow(
  range: AnalyticsRange,
  now: Date = new Date(),
): { from: Date; to: Date } {
  const buckets = buildBuckets(range, now);
  return { from: buckets[0].start, to: buckets[buckets.length - 1].end };
}

/**
 * Fold grouped `{ bucket, value }` SQL rows onto the skeleton, zero-filling
 * gaps. Returns one `{ label, start, value }` per skeleton bucket, oldest first.
 */
export function foldSeries(
  range: AnalyticsRange,
  rows: Array<{ bucket: string | null; value: number | string | bigint }>,
  now: Date = new Date(),
): Array<{ label: string; start: Date; value: number }> {
  const byKey = new Map<string, number>();
  for (const r of rows) {
    if (r.bucket != null) byKey.set(r.bucket, Number(r.value) || 0);
  }
  return buildBuckets(range, now).map((b) => ({
    label: b.label,
    start: b.start,
    value: byKey.get(b.key) ?? 0,
  }));
}
