import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CancelRideDto {
  @ApiProperty({ required: false, example: 'Rider requested pickup elsewhere' })
  @IsOptional()
  @IsString()
  reason?: string;
}
