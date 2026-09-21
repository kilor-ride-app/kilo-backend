// Minimal, dependency-free CSV writer — the report payloads this project
// exports are small, flat aggregate tables, not large/streamed datasets,
// so a manual RFC 4180 writer is simpler than pulling in a CSV library.
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return '';
  }
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvCell(row[h])).join(','));
  }
  return lines.join('\r\n');
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  let str = value instanceof Date ? value.toISOString() : String(value);
  // CSV injection: Excel runs a text cell starting with = + - @ as a formula.
  // Free-text fields (names, addresses, ticket subjects) reach exports, so
  // neutralise them; real numbers are typed `number`, not strings, and pass through.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(str) && Number.isNaN(Number(str))) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
