import { ApiProperty, IntersectionType, OmitType } from '@nestjs/swagger';
import { DeliveryStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { DateRangeQueryDto } from '../../common/dto/date-range-query.dto';
import { ExportFormatDto } from '../../common/export/export-format.dto';

// `from`/`to` (inherited) filter on the request date.
export class ListDeliveriesQueryDto extends DateRangeQueryDto {
  @ApiProperty({ enum: DeliveryStatus, required: false })
  @IsOptional()
  @IsEnum(DeliveryStatus)
  status?: DeliveryStatus;

  @ApiProperty({
    required: false,
    description: 'Delivery id prefix, package description, receiver or sender name',
  })
  @IsOptional()
  @IsString()
  search?: string;
}

export class ExportDeliveriesQueryDto extends IntersectionType(
  OmitType(ListDeliveriesQueryDto, ['take', 'skip'] as const),
  ExportFormatDto,
) {}
