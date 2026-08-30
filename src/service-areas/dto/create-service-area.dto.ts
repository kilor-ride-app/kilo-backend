import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { GeoJsonPolygonDto } from './geojson-polygon.dto';

export class CreateServiceAreaDto {
  @ApiProperty({ example: 'Lagos — Ikeja' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ type: GeoJsonPolygonDto })
  @ValidateNested()
  @Type(() => GeoJsonPolygonDto)
  polygon: GeoJsonPolygonDto;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
