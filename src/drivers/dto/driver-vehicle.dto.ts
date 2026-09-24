import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpsertDriverVehicleDto {
  @ApiProperty({ example: 'Toyota' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  make: string;

  @ApiProperty({ example: 'Camry' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  model: string;

  @ApiProperty({ example: 'Silver' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  color: string;

  // Stored upper-case with single spaces ("LND 234 KJ") so the same plate
  // typed two ways still collides on the unique index.
  @ApiProperty({ example: 'LND 234 KJ' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, ' ') : value,
  )
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9 -]{2,14}$/, { message: 'plateNumber is not a valid plate' })
  plateNumber: string;

  @ApiProperty({ required: false, example: 2019 })
  @IsOptional()
  @IsInt()
  @Min(1980)
  @Max(2100)
  year?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl()
  photoUrl?: string;
}
