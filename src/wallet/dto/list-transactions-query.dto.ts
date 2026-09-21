import { ApiProperty, IntersectionType, OmitType } from '@nestjs/swagger';
import { TransactionStatus, TransactionType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { DateRangeQueryDto } from '../../common/dto/date-range-query.dto';
import { ExportFormatDto } from '../../common/export/export-format.dto';

export class ListTransactionsQueryDto extends DateRangeQueryDto {
  @ApiProperty({ enum: TransactionType, required: false })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiProperty({ enum: TransactionStatus, required: false })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiProperty({ required: false, description: 'Matches the transaction reference' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class ExportTransactionsQueryDto extends IntersectionType(
  OmitType(ListTransactionsQueryDto, ['take', 'skip'] as const),
  ExportFormatDto,
) {}
