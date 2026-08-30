import { ApiProperty, PartialType } from '@nestjs/swagger';
import { ChargingStationStatus } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { CreateChargingStationDto } from './create-charging-station.dto';

export class UpdateChargingStationDto extends PartialType(CreateChargingStationDto) {
  @ApiProperty({ enum: ChargingStationStatus, required: false })
  @IsOptional()
  @IsEnum(ChargingStationStatus)
  status?: ChargingStationStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
