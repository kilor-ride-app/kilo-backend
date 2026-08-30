import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsString,
  Min,
} from 'class-validator';

export class CreateChargingStationDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  address: string;

  @ApiProperty()
  @IsLatitude()
  lat: number;

  @ApiProperty()
  @IsLongitude()
  lng: number;

  @ApiProperty({ type: [String], example: ['CCS', 'Type2'] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  chargerTypes: string[];

  @ApiProperty({ example: 4 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  connectorCount: number;

  @ApiProperty({ example: 60 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  speedKw: number;

  @ApiProperty({ example: 150 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pricePerKwh: number;
}
