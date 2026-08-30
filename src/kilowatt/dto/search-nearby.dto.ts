import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export class SearchNearbyDto {
  @ApiProperty({ example: 6.5244 })
  @IsLatitude()
  lat: number;

  @ApiProperty({ example: 3.3792 })
  @IsLongitude()
  lng: number;

  @ApiProperty({ required: false, default: 10, description: 'Search radius in km' })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  radiusKm?: number = 10;

  @ApiProperty({
    required: false,
    description: 'e.g. CCS, CHAdeMO, Type2 — charging stations only',
  })
  @IsOptional()
  @IsString()
  chargerType?: string;

  @ApiProperty({
    required: false,
    description: 'Minimum charging speed in kW — charging stations only',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minSpeedKw?: number;
}
