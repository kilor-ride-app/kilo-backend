import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RejectKycDto {
  @ApiProperty({ example: 'License image is blurry and expiry date is unreadable' })
  @IsString()
  @MinLength(5)
  reason: string;
}
