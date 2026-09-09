import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChargingStationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

// The admin dashboard speaks in `location`/`latitude`/`longitude`/`totalBays`
// /`availableBays`; the service maps those onto the storage columns
// (`address`/`lat`/`lng`/`connectorCount`/`availableBays`). The energy-spec
// fields (chargerTypes/speedKw/pricePerKwh) stay optional here since the
// dashboard's create form doesn't collect them.
export class CreateChargingStationDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'Surulere, Lagos' })
  @IsString()
  location: string;

  @ApiProperty({ example: 6.5245 })
  @IsLatitude()
  latitude: number;

  @ApiProperty({ example: 3.3285 })
  @IsLongitude()
  longitude: number;

  @ApiProperty({ example: 14, description: 'Total charging bays' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalBays: number;

  @ApiPropertyOptional({ example: 10, description: 'Bays currently free' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  availableBays?: number;

  @ApiPropertyOptional({ enum: ChargingStationStatus, example: ChargingStationStatus.AVAILABLE })
  @IsOptional()
  @IsEnum(ChargingStationStatus)
  status?: ChargingStationStatus;

  @ApiPropertyOptional({ type: [String], example: ['CCS', 'Type2'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  chargerTypes?: string[];

  @ApiPropertyOptional({ example: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  speedKw?: number;

  @ApiPropertyOptional({ example: 150 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pricePerKwh?: number;
}
