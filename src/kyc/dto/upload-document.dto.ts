import { ApiProperty } from '@nestjs/swagger';
import { KycDocumentType } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UploadDocumentDto {
  @ApiProperty({ enum: KycDocumentType })
  @IsEnum(KycDocumentType)
  type: KycDocumentType;
}
