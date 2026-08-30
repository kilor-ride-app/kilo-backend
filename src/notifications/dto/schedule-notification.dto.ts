import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';
import { TargetedDto } from './targeted.dto';

export class ScheduleNotificationDto extends TargetedDto {
  @ApiProperty({ example: '2026-09-01T02:00:00.000Z' })
  @IsDateString()
  scheduledFor: string;
}
