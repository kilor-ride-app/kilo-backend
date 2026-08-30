import { ApiProperty } from '@nestjs/swagger';
import { PartnerOfferAudience } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';

export class CreatePartnerOfferDto {
  @ApiProperty({ example: '20% off your first insurance policy' })
  @IsString()
  title: string;

  @ApiProperty()
  @IsString()
  description: string;

  @ApiProperty({ example: 'AutoCover Insurance' })
  @IsString()
  partnerName: string;

  @ApiProperty({ enum: PartnerOfferAudience, required: false, default: PartnerOfferAudience.BOTH })
  @IsOptional()
  @IsEnum(PartnerOfferAudience)
  audience?: PartnerOfferAudience;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  validFrom?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  validUntil?: string;
}
