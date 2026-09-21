// groupBy({ by: ['status'], _count: true }) rows -> { STATUS: count, ..., total }.
// Statuses with no rows are simply absent — read with `?? 0`.
export function tallyByStatus(
  rows: Array<{ status: string; _count: number }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    out[r.status] = r._count;
    total += r._count;
  }
  return { ...out, total };
}
