import { ApiProperty } from '@nestjs/swagger';
import { ReportFormat, ReportType, ScheduleFrequency } from '@prisma/client';
import { IsEmail, IsEnum } from 'class-validator';

export class ScheduleReportDto {
  @ApiProperty({ enum: ReportType })
  @IsEnum(ReportType)
  type: ReportType;

  @ApiProperty({ enum: ReportFormat, default: ReportFormat.CSV })
  @IsEnum(ReportFormat)
  format: ReportFormat;

  @ApiProperty({ enum: ScheduleFrequency })
  @IsEnum(ScheduleFrequency)
  frequency: ScheduleFrequency;

  @ApiProperty({ example: 'ops@kilo.ng' })
  @IsEmail()
  recipientEmail: string;
}
