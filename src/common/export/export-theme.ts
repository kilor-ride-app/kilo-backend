import { CellFormat, Tone } from './export.types';

// Palette shared by the Excel and PDF renderers. Primary matches the email
// brand (integrations/email/templates/brand.ts) so exports read as Kilo
// documents; hex has no leading '#' because ExcelJS wants ARGB.
export const theme = {
  brand: '4F46E5',
  brandDark: '3730A3',
  brandTint: 'EEF2FF',
  text: '111827',
  muted: '6B7280',
  border: 'E5E7EB',
  band: 'F9FAFB',
  white: 'FFFFFF',
  tone: {
    good: { fg: '166534', bg: 'DCFCE7', accent: '16A34A' },
    warn: { fg: '92400E', bg: 'FEF3C7', accent: 'D97706' },
    bad: { fg: '991B1B', bg: 'FEE2E2', accent: 'DC2626' },
    info: { fg: '1E40AF', bg: 'DBEAFE', accent: '2563EB' },
    neutral: { fg: '374151', bg: 'F3F4F6', accent: '6B7280' },
  } satisfies Record<Tone, { fg: string; bg: string; accent: string }>,
};

const GOOD = new Set([
  'ACTIVE',
  'APPROVED',
  'COMPLETED',
  'PAID',
  'RESOLVED',
  'SUCCESS',
  'SUCCESSFUL',
  'VERIFIED',
  'ONLINE',
  'DELIVERED',
  'CLOSED',
]);
const WARN = new Set([
  'PENDING',
  'PENDING_VERIFICATION',
  'IN_REVIEW',
  'OPEN',
  'PROCESSING',
  'DISPATCHING',
  'ACCEPTED',
  'ARRIVED',
  'IN_PROGRESS',
  'PICKED_UP',
  'ON_TRIP',
  'ASSIGNED',
  'REQUESTED',
  'ON_CREDIT',
  'SENT',
  'ISSUED',
  'NOT_SUBMITTED',
]);
const BAD = new Set([
  'SUSPENDED',
  'REJECTED',
  'CANCELLED',
  'FAILED',
  'DISPUTED',
  'OVERDUE',
  'ESCALATED',
  'DECLINED',
  'NO_DRIVERS_FOUND',
  'EXPIRED',
  'REVERSED',
]);

/** Colour meaning for a status/enum value; unknown values stay neutral. */
export function statusTone(value: unknown): Tone {
  const key = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (GOOD.has(key)) return 'good';
  if (WARN.has(key)) return 'warn';
  if (BAD.has(key)) return 'bad';
  return 'neutral';
}

/** PENDING_VERIFICATION -> "Pending verification". */
export function prettifyStatus(value: unknown): string {
  const text = String(value ?? '')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  // Prisma.Decimal (and anything else that knows how to become a number).
  const n =
    typeof value === 'object' && typeof (value as { toNumber?: unknown }).toNumber === 'function'
      ? (value as { toNumber: () => number }).toNumber()
      : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

// Hand-rolled rather than Intl: newer ICU builds render September as "Sept"
// in en-GB, which breaks the fixed three-letter look of a date column.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

export function formatDate(value: unknown): string {
  const d = toDate(value);
  return d ? `${pad2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '';
}

export function formatDateTime(value: unknown): string {
  const d = toDate(value);
  return d ? `${formatDate(d)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC` : '';
}

/** Effective format of one cell: the row's override (col.formatBy) or the column's. */
export function cellFormat(
  col: { format?: CellFormat; formatBy?: string },
  row: Record<string, unknown>,
): CellFormat {
  const override = col.formatBy ? (row[col.formatBy] as CellFormat | undefined) : undefined;
  return override ?? col.format ?? 'text';
}

const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const MONEY = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Display string for a value, used by the PDF renderer and CSV/width
 * estimation (Excel keeps real typed cells + number formats instead).
 */
export function formatValue(value: unknown, format: CellFormat = 'text'): string {
  if (value === null || value === undefined || value === '') return '';
  switch (format) {
    case 'integer': {
      const n = toNumber(value);
      return n === null ? String(value) : NUMBER.format(Math.round(n));
    }
    case 'number': {
      const n = toNumber(value);
      return n === null ? String(value) : NUMBER.format(n);
    }
    case 'currency': {
      const n = toNumber(value);
      return n === null ? String(value) : `NGN ${MONEY.format(n)}`;
    }
    case 'percent': {
      const n = toNumber(value);
      return n === null ? String(value) : `${(n * 100).toFixed(1)}%`;
    }
    case 'date':
      return formatDate(value);
    case 'datetime':
      return formatDateTime(value);
    case 'status':
      return prettifyStatus(value);
    default:
      return String(value);
  }
}
