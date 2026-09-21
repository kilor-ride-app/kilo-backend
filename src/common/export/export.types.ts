// Shared shape every export (Excel / PDF / CSV) is rendered from. Feature
// services build one ExportDocument — title, headline metrics, one or more
// tables — and the renderers own all layout/colour, so each admin export
// looks the same and a new export is a mapping, not a formatting job.

export const EXPORT_FORMATS = ['xlsx', 'pdf', 'csv'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

// Hard ceiling on rows pulled into a single export — an export is built in
// memory, so an unbounded "export everything" on a large table would take
// the API down. Documents that hit it say so (see ExportSection.truncatedFrom).
export const EXPORT_MAX_ROWS = 10_000;

export type CellFormat =
  | 'text'
  | 'integer'
  | 'number'
  | 'currency' // NGN
  | 'percent' // value is a 0–1 ratio
  | 'date'
  | 'datetime'
  | 'status'; // coloured by meaning (see status-tone.util)

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

export interface ExportColumn {
  key: string;
  header: string;
  format?: CellFormat;
  /** Approx. width in characters; auto-sized from content when omitted. */
  width?: number;
  /** Adds a SUM row for this column (Excel formula / PDF total line). */
  total?: boolean;
  /**
   * Name of a row key holding a CellFormat that overrides `format` for that
   * row — for "Metric | Value" tables where each row is a different unit.
   */
  formatBy?: string;
}

export interface ExportMetric {
  label: string;
  value: number | string | null;
  format?: CellFormat;
  tone?: Tone;
  /** One-line explanation of how the figure is defined — surfaces in Excel. */
  note?: string;
}

export interface ExportSection {
  /** Sheet name in Excel (max 31 chars, sanitised by the renderer). */
  name: string;
  /** Heading above the table; defaults to `name`. */
  title?: string;
  description?: string;
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
  /** Set when `rows` was capped — the full count that matched. */
  truncatedFrom?: number;
}

export interface ExportDocument {
  title: string;
  subtitle?: string;
  generatedBy?: string;
  period?: { from?: Date; to?: Date };
  /** Human-readable filters that were applied, e.g. { Status: 'Active' }. */
  filters?: Record<string, string>;
  summary: ExportMetric[];
  sections: ExportSection[];
  /**
   * Table written by the CSV renderer instead of `sections[0]` — for
   * documents whose first section isn't the flat, re-importable data (e.g.
   * a report whose headline figures live in the summary cards).
   */
  csvSection?: ExportSection;
}

export interface RenderedExport {
  buffer: Buffer;
  contentType: string;
  extension: string;
}
