import { ApiProperty } from '@nestjs/swagger';
import { BusinessStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class SetBusinessStatusDto {
  @ApiProperty({ enum: BusinessStatus })
  @IsEnum(BusinessStatus)
  status: BusinessStatus;
}
