import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    example: 'a1b2c3…',
    description:
      "The token from the reset link sent to the account (email, or SMS for phone-only accounts) — the reset page reads it from the link's ?token= query parameter",
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ minLength: 8, example: 'a-new-strong-password' })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
