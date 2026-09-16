import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    example: '+2348012345678',
    description: 'Phone (E.164) or email — a reset link goes to the account email when there is a verified one, otherwise a code by SMS',
  })
  @IsString()
  identifier: string;
}
