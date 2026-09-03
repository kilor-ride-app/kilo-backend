import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { DateRangeQueryDto } from '../../common/dto/date-range-query.dto';

export class ListNotificationHistoryQueryDto extends DateRangeQueryDto {
  @ApiProperty({ required: false, example: 'SYSTEM' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({ required: false, description: 'Fetch a single campaign by id' })
  @IsOptional()
  @IsString()
  campaignId?: string;
}
