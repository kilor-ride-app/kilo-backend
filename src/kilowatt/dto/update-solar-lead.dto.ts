import { ApiProperty } from '@nestjs/swagger';
import { SolarLeadStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateSolarLeadDto {
  @ApiProperty({ enum: SolarLeadStatus, required: false })
  @IsOptional()
  @IsEnum(SolarLeadStatus)
  status?: SolarLeadStatus;

  @ApiProperty({ required: false, description: 'Staff user ID to assign this lead to' })
  @IsOptional()
  @IsString()
  assignedRepId?: string;
}
