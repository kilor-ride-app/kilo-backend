import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

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
}
