import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsPhoneNumber } from 'class-validator';
import { OtpPurpose } from '../types/otp-purpose.enum';

// EMAIL_VERIFICATION deliberately excluded — that's an authenticated flow
// (POST /users/me/email, /users/me/email/verify), not a phone lookup.
const PHONE_OTP_PURPOSES = [OtpPurpose.REGISTRATION, OtpPurpose.LOGIN] as const;

export class SendOtpDto {
  @ApiProperty({ example: '+2348012345678', description: 'E.164 format' })
  @IsPhoneNumber()
  phone: string;

  @ApiProperty({ enum: PHONE_OTP_PURPOSES, example: OtpPurpose.REGISTRATION })
  @IsIn(PHONE_OTP_PURPOSES)
  purpose: (typeof PHONE_OTP_PURPOSES)[number];
}
