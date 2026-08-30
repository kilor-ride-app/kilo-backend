import { ApiProperty } from '@nestjs/swagger';
import { PromoApplicableService, PromoType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export class CreatePromoDto {
  @ApiProperty({ example: 'WELCOME10' })
  @IsString()
  code: string;

  @ApiProperty({ enum: PromoType })
  @IsEnum(PromoType)
  type: PromoType;

  @ApiProperty({
    description: 'Percentage (0-100) for PERCENTAGE, or a flat NGN amount for FLAT',
    example: 10,
  })
  @Type(() => Number)
  @IsPositive()
  value: number;

  @ApiProperty({ required: false, description: 'Caps a PERCENTAGE discount — ignored for FLAT' })
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  maxDiscount?: number;

  @ApiProperty({ required: false, description: 'Total redemptions allowed across all users' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usageLimitTotal?: number;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usageLimitPerUser?: number;

  @ApiProperty({ example: '2026-09-01T00:00:00.000Z' })
  @IsISO8601()
  validFrom: string;

  @ApiProperty({ example: '2026-12-31T23:59:59.000Z' })
  @IsISO8601()
  validUntil: string;

  @ApiProperty({ enum: PromoApplicableService, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(PromoApplicableService, { each: true })
  applicableServices: PromoApplicableService[];
}
