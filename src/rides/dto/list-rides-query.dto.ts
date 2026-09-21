import { ApiProperty, IntersectionType, OmitType } from '@nestjs/swagger';
import { RideStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { DateRangeQueryDto } from '../../common/dto/date-range-query.dto';
import { ExportFormatDto } from '../../common/export/export-format.dto';

export class ListRidesQueryDto extends DateRangeQueryDto {
  @ApiProperty({ enum: RideStatus, required: false })
  @IsOptional()
  @IsEnum(RideStatus)
  status?: RideStatus;

  @ApiProperty({ required: false, description: 'Ride id prefix, or rider/driver name' })
  @IsOptional()
  @IsString()
  search?: string;
}

// Same filters, no page window — the export covers every match.
export class ExportRidesQueryDto extends IntersectionType(
  OmitType(ListRidesQueryDto, ['take', 'skip'] as const),
  ExportFormatDto,
) {}
