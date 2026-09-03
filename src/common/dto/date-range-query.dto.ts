import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';
import { PaginationDto } from '../../wallet/dto/pagination.dto';

// PaginationDto + an optional [from, to] window. Mixed into the admin list
// DTOs that filter by a created/requested date (rides, transactions, audit
// logs, notification history). Mirrors reports/dto/report-query.dto.ts.
export class DateRangeQueryDto extends PaginationDto {
  @ApiProperty({ required: false, example: '2026-08-01' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiProperty({ required: false, example: '2026-08-31' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

/** Parse optional ISO from/to strings into a Prisma date filter, or undefined. */
export function dateFilter(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;
  const filter: { gte?: Date; lte?: Date } = {};
  if (from) filter.gte = new Date(from);
  if (to) filter.lte = new Date(to);
  return filter;
}
