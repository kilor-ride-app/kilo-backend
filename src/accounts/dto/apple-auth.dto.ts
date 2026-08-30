import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class AppleAuthDto {
  @ApiProperty({ description: 'ID token from Sign in with Apple on the client' })
  @IsString()
  idToken: string;
}
