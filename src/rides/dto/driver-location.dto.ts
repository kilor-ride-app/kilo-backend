import { ApiProperty } from '@nestjs/swagger';
import { IsLatitude, IsLongitude } from 'class-validator';

export class DriverLocationDto {
  @ApiProperty({ example: 6.5244 })
  @IsLatitude()
  lat: number;

  @ApiProperty({ example: 3.3792 })
  @IsLongitude()
  lng: number;
}
