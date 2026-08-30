import { ApiProperty } from '@nestjs/swagger';
import { PromoApplicableService } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsPositive, IsString } from 'class-validator';

export class ValidatePromoDto {
  @ApiProperty({ example: 'WELCOME10' })
  @IsString()
  code: string;

  @ApiProperty({ enum: PromoApplicableService })
  @IsEnum(PromoApplicableService)
  service: PromoApplicableService;

  @ApiProperty({
    description: 'The draft booking fare to validate the promo against',
    example: 2500,
  })
  @Type(() => Number)
  @IsPositive()
  fareAmount: number;
}
