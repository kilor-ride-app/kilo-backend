import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from '../../wallet/dto/pagination.dto';

export const ACTIVITY_FILTERS = ['ALL', 'RIDES', 'DELIVERIES', 'KILOWATT'] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];

export class ListActivityQueryDto extends PaginationDto {
  @ApiProperty({ required: false, enum: ACTIVITY_FILTERS, default: 'ALL' })
  @IsOptional()
  @IsIn(ACTIVITY_FILTERS)
  type?: ActivityFilter = 'ALL';
}
