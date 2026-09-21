// Standard paginated envelope for admin list endpoints. The dashboard's
// list screens need a total count to render pagination controls, which a
// bare `findMany` array can't provide — callers run a
// `prisma.$transaction([findMany, count])` and hand both here.
//
// List screens that also show headline stat cards (drivers, riders) pass a
// `summary` — platform-wide counts, independent of the page/filters, so the
// cards stay correct however many rows the table has.

export interface Paginated<T, S = undefined> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  summary?: S;
}

export function toPaginated<T>(
  data: T[],
  total: number,
  query: { take?: number; skip?: number },
): Paginated<T>;
export function toPaginated<T, S>(
  data: T[],
  total: number,
  query: { take?: number; skip?: number },
  summary: S,
): Paginated<T, S>;
export function toPaginated<T, S>(
  data: T[],
  total: number,
  query: { take?: number; skip?: number },
  summary?: S,
): Paginated<T, S> {
  const pageSize = query.take && query.take > 0 ? query.take : 50;
  const skip = query.skip && query.skip > 0 ? query.skip : 0;
  const page = Math.floor(skip / pageSize) + 1;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    data,
    total,
    page,
    pageSize,
    totalPages,
    hasNextPage: page < totalPages,
    ...(summary !== undefined ? { summary } : {}),
  };
}
