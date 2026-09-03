import { ApiProperty } from '@nestjs/swagger';
import { TransactionStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
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
