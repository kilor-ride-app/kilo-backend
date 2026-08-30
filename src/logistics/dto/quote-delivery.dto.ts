import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { StopInputDto } from './stop-input.dto';

export class QuoteDeliveryDto {
  @ApiProperty({ example: 6.5244 })
  @IsLatitude()
  pickupLat: number;

  @ApiProperty({ example: 3.3792 })
  @IsLongitude()
  pickupLng: number;

  @ApiProperty({ type: [StopInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StopInputDto)
  stops: StopInputDto[];

  // Omit to get quotes across every active tariff, cheapest marked as recommended.
  @ApiProperty({ required: false, example: 'BIKE' })
  @IsOptional()
  @IsString()
  vehicleType?: string;
}
