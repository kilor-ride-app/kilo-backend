import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class GoogleAuthDto {
  @ApiProperty({ description: 'ID token from the Google Sign-In SDK on the client' })
  @IsString()
  idToken: string;
}
