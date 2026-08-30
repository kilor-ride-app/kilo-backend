import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

export class EarningsQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
