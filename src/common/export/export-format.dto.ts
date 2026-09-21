import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { EXPORT_FORMATS, ExportFormat } from './export.types';

// Mixed into every `.../export` query DTO. Excel is the default — it is the
// richest format (summary sheet, colours, filters); PDF is for print/share.
export class ExportFormatDto {
  @ApiProperty({ enum: EXPORT_FORMATS, required: false, default: 'xlsx' })
  @IsOptional()
  @IsIn(EXPORT_FORMATS)
  format: ExportFormat = 'xlsx';
}
