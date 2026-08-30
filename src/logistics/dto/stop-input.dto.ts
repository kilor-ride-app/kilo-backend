import { ApiProperty } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsString } from 'class-validator';

export class StopInputDto {
  @ApiProperty({ example: 6.4531 })
  @IsLatitude()
  lat: number;

  @ApiProperty({ example: 3.3958 })
  @IsLongitude()
  lng: number;

  @ApiProperty({ example: '14 Adeola Odeku Street, Victoria Island, Lagos' })
  @IsString()
  address: string;
}
