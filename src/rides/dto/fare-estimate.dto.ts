import { ApiProperty } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsString } from 'class-validator';

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

  @ApiProperty({ example: 'ECONOMY' })
  @IsString()
  vehicleType: string;
}
