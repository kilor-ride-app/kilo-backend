import { ApiProperty } from '@nestjs/swagger';
import { GuarantorStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../wallet/dto/pagination.dto';

export class ListGuarantorsQueryDto extends PaginationDto {
  @ApiProperty({ enum: GuarantorStatus, required: false })
  @IsOptional()
  @IsEnum(GuarantorStatus)
  status?: GuarantorStatus;
}
