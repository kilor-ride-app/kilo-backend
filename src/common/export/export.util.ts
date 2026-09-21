import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { toCsv } from '../utils/csv.util';
import { renderExcel } from './excel.renderer';
import { cellFormat, formatValue, prettifyStatus, toDate } from './export-theme';
import { ExportDocument, ExportFormat, ExportSection, RenderedExport } from './export.types';
import { renderPdf } from './pdf.renderer';

export async function renderExport(
  doc: ExportDocument,
  format: ExportFormat,
): Promise<RenderedExport> {
  switch (format) {
    case 'pdf':
      return renderPdf(doc);
    case 'csv':
      return renderCsv(doc);
    case 'xlsx':
    default:
      return renderExcel(doc);
  }
}

// CSV is the machine-readable format: no titles, colours or summary block —
// just the data, with the raw values people re-import (ISO dates, plain
// numbers). With several sections the CSV carries the first (the primary
// table); the summary and the rest are what Excel/PDF are for. A document
// with no table at all (a metrics-only report) exports its metrics instead.
function renderCsv(doc: ExportDocument): RenderedExport {
  const section: ExportSection | undefined =
    doc.csvSection ?? doc.sections[0] ?? metricsAsSection(doc);
  const rows = (section?.rows ?? []).map((row) => {
    const out: Record<string, unknown> = {};
    for (const col of section!.columns) {
      const raw = row[col.key];
      switch (cellFormat(col, row)) {
        case 'date':
        case 'datetime':
          out[col.header] = toDate(raw)?.toISOString() ?? '';
          break;
        case 'status':
          out[col.header] = raw == null ? '' : prettifyStatus(raw);
          break;
        case 'currency':
        case 'integer':
        case 'number':
          out[col.header] = raw == null ? '' : formatValue(raw, 'number').replace(/,/g, '');
          break;
        default:
          out[col.header] = raw ?? '';
      }
    }
    return out;
  });

  // Header-only file for an empty result, instead of a 0-byte one.
  const csv =
    rows.length > 0
      ? toCsv(rows)
      : (section?.columns ?? []).map((c) => `"${c.header.replace(/"/g, '""')}"`).join(',');
  // BOM so Excel opens UTF-8 (names with accents) correctly.
  return {
    buffer: Buffer.from(`﻿${csv}`, 'utf-8'),
    contentType: 'text/csv; charset=utf-8',
    extension: 'csv',
  };
}

function metricsAsSection(doc: ExportDocument): ExportSection | undefined {
  if (doc.summary.length === 0) return undefined;
  return {
    name: 'Metrics',
    columns: [
      { key: 'label', header: 'Metric' },
      { key: 'value', header: 'Value', formatBy: 'format' },
      { key: 'note', header: 'Definition' },
    ],
    rows: doc.summary.map((m) => ({
      label: m.label,
      value: m.value,
      format: m.format ?? 'text',
      note: m.note ?? '',
    })),
  };
}

/** `kilo-drivers-2026-09-21.xlsx` */
export function exportFilename(base: string, extension: string, at = new Date()): string {
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `kilo-${slug}-${at.toISOString().slice(0, 10)}.${extension}`;
}

/**
 * Renders the document and writes the download headers. Controllers call this
 * with `@Res({ passthrough: true })` and return its result.
 */
export async function sendExport(
  res: Response,
  doc: ExportDocument,
  format: ExportFormat,
  filenameBase: string,
): Promise<StreamableFile> {
  const rendered = await renderExport(doc, format);
  res.set({
    'Content-Type': rendered.contentType,
    'Content-Disposition': `attachment; filename="${exportFilename(filenameBase, rendered.extension)}"`,
    'Content-Length': String(rendered.buffer.length),
    'Cache-Control': 'no-store',
  });
  return new StreamableFile(rendered.buffer);
}
