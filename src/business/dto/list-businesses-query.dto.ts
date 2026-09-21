import { ApiProperty, IntersectionType, OmitType } from '@nestjs/swagger';
import { BusinessStatus } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { ExportFormatDto } from '../../common/export/export-format.dto';
import { PaginationDto } from '../../wallet/dto/pagination.dto';

export const CREDIT_STATUSES = ['OVERDUE', 'ON_CREDIT', 'NO_CREDIT'] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];

export class ListBusinessesQueryDto extends PaginationDto {
  @ApiProperty({ required: false, description: 'Matches company name or contact email' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ enum: BusinessStatus, required: false, description: 'Account operational status' })
  @IsOptional()
  @IsEnum(BusinessStatus)
  status?: BusinessStatus;

  @ApiProperty({
    required: false,
    enum: CREDIT_STATUSES,
    description: 'Credit & billing health (derived from outstanding balance and overdue invoices)',
  })
  @IsOptional()
  @IsIn(CREDIT_STATUSES)
  creditStatus?: CreditStatus;
}

export class ExportBusinessesQueryDto extends IntersectionType(
  OmitType(ListBusinessesQueryDto, ['take', 'skip'] as const),
  ExportFormatDto,
) {}
