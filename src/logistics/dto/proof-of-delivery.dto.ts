import { ApiProperty } from '@nestjs/swagger';
import { ProofOfDeliveryType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ProofOfDeliveryDto {
  @ApiProperty({ enum: ProofOfDeliveryType })
  @IsEnum(ProofOfDeliveryType)
  type: ProofOfDeliveryType;

  // Required when type is OTP — the code the receiver read out to the
  // driver, checked against Delivery.receiverOtpHash. Ignored for
  // SIGNATURE/PHOTO, which instead take the multipart `file` field.
  @ApiProperty({ required: false, example: '482913' })
  @IsOptional()
  @IsString()
  otpCode?: string;
}
