import { ApiProperty } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsOptional, IsString } from 'class-validator';

export class FareEstimateDto {
  @ApiProperty({ example: 6.5244 })
  @IsLatitude()
  pickupLat: number;

  @ApiProperty({ example: 3.3792 })
  @IsLongitude()
  pickupLng: number;

  @ApiProperty({ example: 6.4531 })
  @IsLatitude()
  dropoffLat: number;

  @ApiProperty({ example: 3.3958 })
  @IsLongitude()
  dropoffLng: number;

  @ApiProperty({
    required: false,
    example: 'ECONOMY',
    description: 'Omit to get every ride option for the route (the vehicle picker)',
  })
  @IsOptional()
  @IsString()
  vehicleType?: string;

  @ApiProperty({
    required: false,
    example: 'KILO50',
    description: 'Applied only when the request carries a valid access token',
  })
  @IsOptional()
  @IsString()
  promoCode?: string;
}
