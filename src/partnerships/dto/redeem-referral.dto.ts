import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RedeemReferralDto {
  @ApiProperty({ example: 'ABCD1234' })
  @IsString()
  code: string;
}
