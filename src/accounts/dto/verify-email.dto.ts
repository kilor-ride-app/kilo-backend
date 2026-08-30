import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit numeric string' })
  code: string;
}
