import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

// Defaults to the trailing 30 days when omitted — see ReportsService.resolvePeriod.
export class ReportQueryDto {
  @ApiProperty({ required: false, example: '2026-08-01' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiProperty({ required: false, example: '2026-08-31' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
