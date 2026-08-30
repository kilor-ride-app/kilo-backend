import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsPhoneNumber, Matches } from 'class-validator';
import { OtpPurpose } from '../types/otp-purpose.enum';

const PHONE_OTP_PURPOSES = [OtpPurpose.REGISTRATION, OtpPurpose.LOGIN] as const;

export class VerifyOtpDto {
  @ApiProperty({ example: '+2348012345678', description: 'E.164 format' })
  @IsPhoneNumber()
  phone: string;

  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit numeric string' })
  code: string;

  @ApiProperty({ enum: PHONE_OTP_PURPOSES, example: OtpPurpose.REGISTRATION })
  @IsIn(PHONE_OTP_PURPOSES)
  purpose: (typeof PHONE_OTP_PURPOSES)[number];
}
