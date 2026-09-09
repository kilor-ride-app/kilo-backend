import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateBatterySwapStationDto } from './create-battery-swap-station.dto';

export class UpdateBatterySwapStationDto extends PartialType(CreateBatterySwapStationDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
