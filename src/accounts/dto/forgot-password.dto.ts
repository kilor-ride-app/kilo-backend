import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    example: '+2348012345678',
    description:
      'Phone (E.164) or email — a reset link is emailed to the account when it has a verified email, otherwise sent by SMS',
  })
  @IsString()
  identifier: string;
}
