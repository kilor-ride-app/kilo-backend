import { ApiProperty } from '@nestjs/swagger';
import { SolarLeadStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../wallet/dto/pagination.dto';

export class ListSolarLeadsQueryDto extends PaginationDto {
  @ApiProperty({ enum: SolarLeadStatus, required: false })
  @IsOptional()
  @IsEnum(SolarLeadStatus)
  status?: SolarLeadStatus;
}
