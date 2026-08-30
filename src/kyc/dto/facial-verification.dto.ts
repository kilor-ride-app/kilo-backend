import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class FacialVerificationDto {
  @ApiProperty({ description: 'Base64-encoded selfie image' })
  @IsString()
  selfieImageBase64: string;
}
