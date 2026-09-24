import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsOptional, IsString, MinLength } from 'class-validator';

export class AutocompleteQueryDto {
  @ApiProperty({ example: 'Ikeja City Mall' })
  @IsString()
  @MinLength(2)
  query: string;

  @ApiProperty({ required: false, description: 'Bias results toward this point (with lng)' })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;
}

export class PlaceDetailsQueryDto {
  @ApiProperty({ description: 'placeId from /places/autocomplete' })
  @IsString()
  @MinLength(1)
  placeId: string;
}

export class ReverseGeocodeQueryDto {
  @ApiProperty({ example: 6.4478 })
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @ApiProperty({ example: 3.4723 })
  @Type(() => Number)
  @IsLongitude()
  lng: number;
}
