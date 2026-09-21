import { ApiProperty, IntersectionType, OmitType } from '@nestjs/swagger';
import { TransactionStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { ExportFormatDto } from '../../common/export/export-format.dto';
import { PaginationDto } from './pagination.dto';

export class ListWithdrawalsQueryDto extends PaginationDto {
  @ApiProperty({
    enum: TransactionStatus,
    required: false,
    description: 'WithdrawalRequest lifecycle status (PENDING is the approval queue)',
  })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;
}

export class ExportWithdrawalsQueryDto extends IntersectionType(
  OmitType(ListWithdrawalsQueryDto, ['take', 'skip'] as const),
  ExportFormatDto,
) {}
