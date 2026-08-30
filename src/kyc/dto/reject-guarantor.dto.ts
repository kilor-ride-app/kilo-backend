import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RejectGuarantorDto {
  @ApiProperty({ example: 'ID document is illegible — please re-upload a clearer photo' })
  @IsString()
  reason: string;
}
