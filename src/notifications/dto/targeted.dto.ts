import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { BroadcastDto } from './broadcast.dto';
import { NotificationSegmentDto } from './notification-segment.dto';

export class TargetedDto extends BroadcastDto {
  @ApiProperty({ type: NotificationSegmentDto })
  @ValidateNested()
  @Type(() => NotificationSegmentDto)
  segment: NotificationSegmentDto;
}
