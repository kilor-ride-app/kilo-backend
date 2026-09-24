import { ApiProperty } from '@nestjs/swagger';
import { TariffServiceType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateTariffDto {
  @ApiProperty({ example: 'ECONOMY', description: 'Free-form — no fixed vehicle-type enum' })
  @IsString()
  vehicleType: string;

  @ApiProperty({
    required: false,
    description: 'Omit for a default/fallback tariff not tied to a specific area',
  })
  @IsOptional()
  @IsUUID()
  serviceAreaId?: string;

  @ApiProperty({ example: 500 })
  @IsNumber()
  @Min(0)
  baseFare: number;

  @ApiProperty({ example: 120 })
  @IsNumber()
  @Min(0)
  perKmRate: number;

  @ApiProperty({ example: 30 })
  @IsNumber()
  @Min(0)
  perMinuteRate: number;

  @ApiProperty({ example: 800 })
  @IsNumber()
  @Min(0)
  minimumFare: number;

  @ApiProperty({ example: 500 })
  @IsNumber()
  @Min(0)
  cancellationFee: number;

  @ApiProperty({ required: false, default: 'NGN' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({
    required: false,
    enum: TariffServiceType,
    description: 'Which product this prices. Omit for a tariff that applies to every service.',
  })
  @IsOptional()
  @IsEnum(TariffServiceType)
  serviceType?: TariffServiceType;

  @ApiProperty({ required: false, example: 'Bike', description: 'Label in the vehicle picker' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  displayName?: string;

  @ApiProperty({ required: false, example: 'Best for light, small packages' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  description?: string;

  @ApiProperty({ required: false, default: 0, description: 'Lower sorts first in the picker' })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiProperty({
    required: false,
    default: 1,
    example: 0.8,
    description: "Scales route driving time into this vehicle's ETA (bike < 1, truck > 1)",
  })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(10)
  durationMultiplier?: number;
}
