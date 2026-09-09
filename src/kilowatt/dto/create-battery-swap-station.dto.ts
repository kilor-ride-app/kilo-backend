import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BatterySwapStationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

// See CreateChargingStationDto for the naming rationale. Maps onto
// `address`/`lat`/`lng`/`totalSlots`/`availableBatteries`/`status`.
export class CreateBatterySwapStationDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'Alausa, Ikeja' })
  @IsString()
  location: string;

  @ApiProperty({ example: 6.6018 })
  @IsLatitude()
  latitude: number;

  @ApiProperty({ example: 3.3515 })
  @IsLongitude()
  longitude: number;

  @ApiProperty({ example: 12, description: 'Total battery slots' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalBays: number;

  @ApiProperty({ example: 8, description: 'Charged batteries currently available' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  availableBays: number;

  @ApiPropertyOptional({
    enum: BatterySwapStationStatus,
    example: BatterySwapStationStatus.AVAILABLE,
  })
  @IsOptional()
  @IsEnum(BatterySwapStationStatus)
  status?: BatterySwapStationStatus;

  @ApiPropertyOptional({ example: 2500 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pricePerSwap?: number;
}
