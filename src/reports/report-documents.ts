import { ReportType } from '@prisma/client';
import { prettifyStatus, toNumber } from '../common/export/export-theme';
import {
  CellFormat,
  ExportColumn,
  ExportDocument,
  ExportMetric,
  ExportSection,
} from '../common/export/export.types';

// Turns the flat rows a ReportsService generator returns into a documented
// ExportDocument: labelled headline metrics (each with its definition),
// breakdown tables for the dynamic `status_*` / `amount_*` style keys, and
// a flat CSV variant. The numbers come from the same generators the JSON
// endpoints use, so an export can never disagree with the on-screen report.

type Row = Record<string, unknown>;

interface ReportPeriod {
  from: Date;
  to: Date;
}

interface Body {
  subtitle: string;
  summary: ExportMetric[];
  sections?: ExportSection[];
  /** Extra rows appended to the flat CSV (the breakdown tables). */
  csvExtra?: Array<{ label: string; value: unknown; format: CellFormat; note?: string }>;
}

const TITLES: Record<ReportType, string> = {
  RIDERS: 'Riders Report',
  DRIVERS: 'Drivers Report',
  RIDES: 'Rides Report',
  LOGISTICS: 'Logistics Report',
  BUSINESS: 'Business Accounts Report',
  KILOWATT: 'Kilowatt (Energy) Report',
  FINANCE: 'Finance Report',
  SUPPORT: 'Support Report',
};

export function reportTitle(type: ReportType): string {
  return TITLES[type];
}

export function buildReportDocument(
  type: ReportType,
  rows: Row[],
  period: ReportPeriod,
  generatedBy: string,
): ExportDocument {
  const body = BUILDERS[type](rows);
  const doc: ExportDocument = {
    title: TITLES[type],
    subtitle: body.subtitle,
    generatedBy,
    period,
    summary: body.summary,
    sections: body.sections ?? [],
  };

  // Logistics' primary data is its by-vehicle table, which CSV already
  // exports as sections[0]; every other report is a metric list.
  if (type !== ReportType.LOGISTICS) {
    doc.csvSection = {
      name: 'Metrics',
      columns: [
        { key: 'label', header: 'Metric' },
        { key: 'value', header: 'Value', formatBy: 'format' },
        { key: 'note', header: 'Definition' },
      ],
      rows: [
        ...body.summary.map((m) => ({
          label: m.label,
          value: m.value,
          format: m.format ?? 'text',
          note: m.note ?? '',
        })),
        ...(body.csvExtra ?? []).map((m) => ({ ...m, note: m.note ?? '' })),
      ],
    };
  }
  return doc;
}

const BUILDERS: Record<ReportType, (rows: Row[]) => Body> = {
  RIDERS: ([r = {}]) => {
    const total = n(r.totalRiders);
    return {
      subtitle: 'Rider base size, sign-ups and activity in the period',
      summary: [
        {
          label: 'Total riders',
          value: total,
          format: 'integer',
          note: 'All accounts with the rider role, all-time.',
        },
        {
          label: 'New riders',
          value: n(r.newRidersInPeriod),
          format: 'integer',
          tone: 'info',
          note: 'Riders who registered inside the report period.',
        },
        {
          label: 'Active riders',
          value: n(r.activeRidersInPeriod),
          format: 'integer',
          tone: 'good',
          note: 'Distinct riders who requested at least one ride inside the period.',
        },
        {
          label: 'Activity rate',
          value: ratio(n(r.activeRidersInPeriod), total),
          format: 'percent',
          note: 'Active riders ÷ total riders.',
        },
      ],
    };
  },

  DRIVERS: ([r = {}]) => ({
    subtitle: 'Driver supply, live availability and ride completion',
    summary: [
      {
        label: 'Total drivers',
        value: n(r.totalDrivers),
        format: 'integer',
        note: 'All accounts with the driver role, all-time.',
      },
      {
        label: 'Online now',
        value: n(r.onlineDrivers),
        format: 'integer',
        tone: 'good',
        note: 'Live snapshot: drivers whose availability is not OFFLINE right now (not limited to the period).',
      },
      {
        label: 'Completed rides',
        value: n(r.completedRidesInPeriod),
        format: 'integer',
        tone: 'info',
        note: 'Rides completed inside the report period.',
      },
      {
        label: 'Offer acceptance rate',
        value: nullable(r.offerAcceptanceRate),
        format: 'percent',
        note: 'Accepted ride offers ÷ all ride offers created in the period.',
      },
    ],
  }),

  RIDES: ([r = {}]) => {
    const statuses = entriesWithPrefix(r, 'status_');
    return {
      subtitle: 'Ride volume, completion and platform revenue',
      summary: [
        {
          label: 'Total rides',
          value: n(r.totalRides),
          format: 'integer',
          note: 'Rides requested inside the period, any outcome.',
        },
        {
          label: 'Completed rides',
          value: n(r.completedRides),
          format: 'integer',
          tone: 'good',
          note: 'Rides with status COMPLETED.',
        },
        {
          label: 'Completion rate',
          value: nullable(r.completionRate),
          format: 'percent',
          note: 'Completed rides ÷ total rides.',
        },
        {
          label: 'Platform revenue',
          value: n(r.totalRevenue),
          format: 'currency',
          tone: 'info',
          note: 'Commission earned on rides completed in the period.',
        },
        {
          label: 'Total fare volume',
          value: n(r.totalFareVolume),
          format: 'currency',
          note: 'Sum of final fares on rides completed in the period (gross, before driver payout).',
        },
        {
          label: 'Revenue per completed ride',
          value: nullable(r.revenuePerCompletedRide),
          format: 'currency',
          note: 'Platform revenue ÷ completed rides.',
        },
      ],
      sections: distribution(
        'Rides by status',
        'Every ride requested in the period, grouped by its current status.',
        statuses,
        'Status',
        'status',
      ),
      csvExtra: statuses.map(({ key, value }) => ({
        label: `Rides — ${prettifyStatus(key)}`,
        value,
        format: 'integer' as const,
      })),
    };
  },

  LOGISTICS: (rows) => {
    const total = rows.reduce((a, r) => a + n(r.totalDeliveries), 0);
    const completed = rows.reduce((a, r) => a + n(r.completedDeliveries), 0);
    return {
      subtitle: 'Delivery volume and success rate by vehicle type',
      summary: [
        {
          label: 'Total deliveries',
          value: total,
          format: 'integer',
          note: 'Deliveries requested inside the period, any outcome.',
        },
        {
          label: 'Completed deliveries',
          value: completed,
          format: 'integer',
          tone: 'good',
          note: 'Deliveries with status COMPLETED.',
        },
        {
          label: 'Success rate',
          value: ratio(completed, total),
          format: 'percent',
          note: 'Completed deliveries ÷ total deliveries.',
        },
        {
          label: 'Vehicle types used',
          value: rows.length,
          format: 'integer',
          note: 'Distinct vehicle types with at least one delivery.',
        },
      ],
      sections: [
        {
          name: 'By vehicle type',
          description: 'Deliveries requested in the period, per vehicle type.',
          columns: [
            { key: 'vehicleType', header: 'Vehicle type', width: 22 },
            { key: 'totalDeliveries', header: 'Total deliveries', format: 'integer', total: true },
            { key: 'completedDeliveries', header: 'Completed', format: 'integer', total: true },
            { key: 'successRate', header: 'Success rate', format: 'percent' },
          ],
          rows,
        },
      ],
    };
  },

  BUSINESS: ([r = {}]) => ({
    subtitle: 'Business accounts and invoicing',
    summary: [
      {
        label: 'Total businesses',
        value: n(r.totalBusinesses),
        format: 'integer',
        note: 'Every registered business account, all-time.',
      },
      {
        label: 'Invoices issued',
        value: n(r.invoicesInPeriod),
        format: 'integer',
        note: 'Invoices created inside the period.',
      },
      {
        label: 'Invoices paid',
        value: n(r.paidInvoices),
        format: 'integer',
        tone: 'good',
        note: 'Of those, invoices with status PAID.',
      },
      {
        label: 'Total invoiced',
        value: n(r.totalInvoicedAmount),
        format: 'currency',
        tone: 'info',
        note: 'Sum of all invoices created in the period.',
      },
      {
        label: 'Total collected',
        value: n(r.totalPaidAmount),
        format: 'currency',
        tone: 'good',
        note: 'Sum of PAID invoices created in the period.',
      },
      {
        label: 'Collection rate',
        value: ratio(n(r.totalPaidAmount), n(r.totalInvoicedAmount)),
        format: 'percent',
        note: 'Collected amount ÷ invoiced amount.',
      },
    ],
  }),

  KILOWATT: ([r = {}]) => {
    const leads = entriesWithPrefix(r, 'solarLeads_');
    return {
      subtitle: 'Charging network, battery swaps and solar leads',
      summary: [
        {
          label: 'Active charging stations',
          value: n(r.activeChargingStations),
          format: 'integer',
          tone: 'good',
          note: 'Charging stations currently marked active (live snapshot).',
        },
        {
          label: 'Battery swap reservations',
          value: n(r.swapReservationsInPeriod),
          format: 'integer',
          note: 'Swap reservations created inside the period.',
        },
        {
          label: 'Solar leads',
          value: n(r.solarLeadsInPeriod),
          format: 'integer',
          tone: 'info',
          note: 'Solar assessment requests created inside the period.',
        },
      ],
      sections: distribution(
        'Solar leads by status',
        'Solar assessment requests created in the period, by pipeline status.',
        leads,
        'Status',
        'status',
      ),
      csvExtra: leads.map(({ key, value }) => ({
        label: `Solar leads — ${prettifyStatus(key)}`,
        value,
        format: 'integer' as const,
      })),
    };
  },

  FINANCE: ([r = {}]) => {
    // amount_<TYPE> / count_<TYPE> pairs -> one row per transaction type
    const types = new Map<string, { type: string; count: number; amount: number }>();
    for (const [key, value] of Object.entries(r)) {
      const m = /^(amount|count)_(.+)$/.exec(key);
      if (!m) continue;
      const row = types.get(m[2]) ?? { type: m[2], count: 0, amount: 0 };
      if (m[1] === 'amount') row.amount = n(value);
      else row.count = n(value);
      types.set(m[2], row);
    }
    const byType = [...types.values()].sort((a, b) => b.amount - a.amount);
    return {
      subtitle: 'Platform revenue, transaction volume and withdrawals',
      summary: [
        {
          label: 'Recognised revenue',
          value: n(r.totalRecognizedRevenue),
          format: 'currency',
          tone: 'good',
          note: 'Current balance of the platform revenue account — all-time, not limited to the period.',
        },
        {
          label: 'Transactions',
          value: n(r.transactionVolumeInPeriod),
          format: 'integer',
          tone: 'info',
          note: 'Ledger transactions created inside the period.',
        },
        {
          label: 'Withdrawals',
          value: n(r.totalWithdrawalsInPeriod),
          format: 'currency',
          tone: 'warn',
          note: 'Total value of wallet withdrawals in the period.',
        },
      ],
      sections:
        byType.length === 0
          ? []
          : [
              {
                name: 'By transaction type',
                description: 'Ledger transactions created in the period, grouped by type.',
                columns: [
                  { key: 'type', header: 'Transaction type', format: 'status', width: 30 },
                  { key: 'count', header: 'Transactions', format: 'integer', total: true },
                  // no total: it would add inflows (top-ups) to outflows (withdrawals)
                  { key: 'amount', header: 'Total amount', format: 'currency' },
                ],
                rows: byType,
              },
            ],
      csvExtra: byType.flatMap((t) => [
        { label: `${prettifyStatus(t.type)} — count`, value: t.count, format: 'integer' as const },
        {
          label: `${prettifyStatus(t.type)} — amount`,
          value: t.amount,
          format: 'currency' as const,
        },
      ]),
    };
  },

  SUPPORT: ([r = {}]) => {
    const statuses = entriesWithPrefix(r, 'status_');
    return {
      subtitle: 'Ticket volume and resolution speed',
      summary: [
        {
          label: 'Tickets opened',
          value: n(r.totalTicketsInPeriod),
          format: 'integer',
          note: 'Tickets created inside the period.',
        },
        {
          label: 'Tickets resolved',
          value: n(r.resolvedInPeriod),
          format: 'integer',
          tone: 'good',
          note: 'Tickets resolved inside the period (may have been opened earlier).',
        },
        {
          label: 'Avg. resolution time (hours)',
          value: nullable(r.avgResolutionHours),
          format: 'number',
          tone: 'info',
          note: 'Mean time from creation to resolution, for tickets resolved in the period.',
        },
      ],
      sections: distribution(
        'Tickets by status',
        'Tickets created in the period, grouped by current status.',
        statuses,
        'Status',
        'status',
      ),
      csvExtra: statuses.map(({ key, value }) => ({
        label: `Tickets — ${prettifyStatus(key)}`,
        value,
        format: 'integer' as const,
      })),
    };
  },
};

// ── helpers ─────────────────────────────────────────────────────────────

function n(value: unknown): number {
  return toNumber(value) ?? 0;
}

function nullable(value: unknown): number | null {
  return toNumber(value);
}

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

function entriesWithPrefix(row: Row, prefix: string): Array<{ key: string; value: number }> {
  return Object.entries(row)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => ({ key: k.slice(prefix.length), value: n(v) }))
    .sort((a, b) => b.value - a.value);
}

function distribution(
  name: string,
  description: string,
  entries: Array<{ key: string; value: number }>,
  labelHeader: string,
  labelFormat: ExportColumn['format'],
): ExportSection[] {
  if (entries.length === 0) return [];
  const total = entries.reduce((a, e) => a + e.value, 0);
  return [
    {
      name,
      description,
      columns: [
        { key: 'label', header: labelHeader, format: labelFormat, width: 24 },
        { key: 'count', header: 'Count', format: 'integer', total: true },
        { key: 'share', header: 'Share', format: 'percent' },
      ],
      rows: entries.map((e) => ({
        label: e.key,
        count: e.value,
        share: total > 0 ? e.value / total : null,
      })),
    },
  ];
}
