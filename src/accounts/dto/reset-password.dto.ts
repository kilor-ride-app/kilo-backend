import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ example: '+2348012345678', description: 'Phone (E.164) or email — same value used for /auth/password/forgot' })
  @IsString()
  identifier: string;

  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit numeric string' })
  code: string;

  @ApiProperty({ minLength: 8, example: 'a-new-strong-password' })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
