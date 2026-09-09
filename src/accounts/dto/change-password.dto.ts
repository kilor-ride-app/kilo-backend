import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldPassword123!' })
  @IsString()
  currentPassword: string;

  @ApiProperty({ minLength: 8, example: 'NewSecurePassword456#' })
  @IsString()
  @MinLength(8)
  newPassword: string;

  @ApiProperty({ minLength: 8, example: 'NewSecurePassword456#' })
  @IsString()
  @MinLength(8)
  confirmPassword: string;
}
