import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength, ValidateIf } from 'class-validator';

export class ResetPasswordDto {
  @ApiPropertyOptional({
    example: 'a1b2c3...',
    description: 'Token from the reset-password link emailed to the account — mutually exclusive with identifier/code',
  })
  @ValidateIf((o) => !o.identifier)
  @IsString()
  token?: string;

  @ApiPropertyOptional({
    example: '+2348012345678',
    description: 'Phone or email, for the SMS-code fallback path (phone-only accounts) — used with `code`',
  })
  @ValidateIf((o) => !o.token)
  @IsString()
  identifier?: string;

  @ApiPropertyOptional({ example: '123456' })
  @ValidateIf((o) => !o.token)
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit numeric string' })
  code?: string;

  @ApiProperty({ minLength: 8, example: 'a-new-strong-password' })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
