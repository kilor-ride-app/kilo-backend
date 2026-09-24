import { ApiProperty } from '@nestjs/swagger';
import { TopUpMethod } from '@prisma/client';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class TopUpDto {
  @ApiProperty({ example: 5000, description: 'Amount in NGN (major unit, not kobo)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(100)
  amount: number;

  @ApiProperty({
    enum: TopUpMethod,
    required: false,
    default: TopUpMethod.CARD,
    description:
      'CARD: Paystack checkout (use accessCode with the mobile SDK). SAVED_CARD: charge cardId. BANK_TRANSFER: returns a one-off account to pay into.',
  })
  @IsOptional()
  @IsEnum(TopUpMethod)
  method?: TopUpMethod;

  @ApiProperty({ required: false, description: 'Required for SAVED_CARD — from GET /wallet/cards' })
  @IsOptional()
  @IsUUID()
  cardId?: string;

  @ApiProperty({
    required: false,
    default: false,
    description: 'CARD only — save the card for future top-ups once the payment succeeds',
  })
  @IsOptional()
  @IsBoolean()
  saveCard?: boolean;
}
