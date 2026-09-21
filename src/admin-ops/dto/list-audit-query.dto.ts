import { ApiProperty, IntersectionType, OmitType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { DateRangeQueryDto } from '../../common/dto/date-range-query.dto';
import { ExportFormatDto } from '../../common/export/export-format.dto';

export class ListAuditQueryDto extends DateRangeQueryDto {
  @ApiProperty({ required: false, example: 'user.suspend' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiProperty({ required: false, example: 'User' })
  @IsOptional()
  @IsString()
  targetType?: string;

  @ApiProperty({ required: false, description: 'Filter by the acting admin user id' })
  @IsOptional()
  @IsString()
  actorId?: string;
}

export class ExportAuditQueryDto extends IntersectionType(
  OmitType(ListAuditQueryDto, ['take', 'skip'] as const),
  ExportFormatDto,
) {}
