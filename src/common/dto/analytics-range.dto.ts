import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { ANALYTICS_RANGES, AnalyticsRange } from '../utils/time-bucket.util';

// Shared by every dashboard time-series endpoint (Platform Analytics,
// top-up trend, revenue-by-service). Defaults to '7days' to match the
// frontend's default tab.
export class AnalyticsRangeDto {
  @ApiProperty({ enum: ANALYTICS_RANGES, required: false, default: '7days' })
  @IsOptional()
  @IsIn(ANALYTICS_RANGES)
  range: AnalyticsRange = '7days';
}
