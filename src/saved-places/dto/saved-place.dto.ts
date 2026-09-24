import { ApiProperty, PartialType } from '@nestjs/swagger';
import { SavedPlaceLabel } from '@prisma/client';
import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateSavedPlaceDto {
  @ApiProperty({ enum: SavedPlaceLabel, example: SavedPlaceLabel.HOME })
  @IsEnum(SavedPlaceLabel)
  label: SavedPlaceLabel;

  @ApiProperty({
    required: false,
    example: "Mum's Place",
    description: 'Display name for OTHER places — HOME and WORK are named by their label',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @ApiProperty({ example: '14 Admiralty Way, Lekki, Lagos' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ example: 6.4478 })
  @IsLatitude()
  lat: number;

  @ApiProperty({ example: 3.4723 })
  @IsLongitude()
  lng: number;
}

export class UpdateSavedPlaceDto extends PartialType(CreateSavedPlaceDto) {}
