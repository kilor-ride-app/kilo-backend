import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const STAFF_STATUS_FILTERS = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export type StaffStatusFilter = (typeof STAFF_STATUS_FILTERS)[number];

export class ListStaffQueryDto {
  @ApiPropertyOptional({
    enum: STAFF_STATUS_FILTERS,
    description: 'INACTIVE is treated as SUSPENDED (no separate account state).',
  })
  @IsOptional()
  @IsIn(STAFF_STATUS_FILTERS)
  status?: StaffStatusFilter;
}
