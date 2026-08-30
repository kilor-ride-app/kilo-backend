import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class VerifyReceiverOtpDto {
  @ApiProperty({ example: '482913' })
  @IsString()
  code: string;
}
