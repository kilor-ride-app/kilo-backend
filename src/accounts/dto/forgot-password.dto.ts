import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    example: '+2348012345678',
    description: 'Phone (E.164) or email — the reset code goes to the account email when there is a verified one, otherwise by SMS',
  })
  @IsString()
  identifier: string;
}
