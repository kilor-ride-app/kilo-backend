// Standard paginated envelope for admin list endpoints. The dashboard's
// list screens need a total count to render pagination controls, which a
// bare `findMany` array can't provide — callers run a
// `prisma.$transaction([findMany, count])` and hand both here.

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function toPaginated<T>(
  data: T[],
  total: number,
  query: { take?: number; skip?: number },
): Paginated<T> {
  const pageSize = query.take && query.take > 0 ? query.take : 50;
  const skip = query.skip && query.skip > 0 ? query.skip : 0;
  return {
    data,
    total,
    page: Math.floor(skip / pageSize) + 1,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
