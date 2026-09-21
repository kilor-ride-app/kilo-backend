import { ApiProperty } from '@nestjs/swagger';
import { ReportFormat, ReportType } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional } from 'class-validator';

export class ExportReportDto {
  @ApiProperty({ enum: ReportType })
  @IsEnum(ReportType)
  type: ReportType;

  @ApiProperty({
    enum: ReportFormat,
    default: ReportFormat.XLSX,
    description: 'XLSX = formatted workbook, PDF = printable report, CSV = raw metrics',
  })
  @IsOptional()
  @IsEnum(ReportFormat)
  format: ReportFormat = ReportFormat.XLSX;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
