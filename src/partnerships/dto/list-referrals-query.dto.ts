import { ApiProperty } from '@nestjs/swagger';
import { ReferralRedemptionStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../wallet/dto/pagination.dto';

export class ListReferralsQueryDto extends PaginationDto {
  @ApiProperty({ enum: ReferralRedemptionStatus, required: false })
  @IsOptional()
  @IsEnum(ReferralRedemptionStatus)
  status?: ReferralRedemptionStatus;
}
