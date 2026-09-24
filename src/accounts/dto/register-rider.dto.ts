import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsPhoneNumber, IsString } from 'class-validator';

// Riders sign in with phone + OTP only (POST /auth/otp/send with purpose
// LOGIN, then /auth/otp/verify) — there is no rider password to set.
export class RegisterRiderDto {
  @ApiProperty({ example: 'Ada' })
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Obi' })
  @IsString()
  lastName: string;

  @ApiProperty({ example: '+2348012345678', description: 'E.164 format' })
  @IsPhoneNumber()
  phone: string;

  @ApiProperty({ example: 'ada@example.com', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;
}
