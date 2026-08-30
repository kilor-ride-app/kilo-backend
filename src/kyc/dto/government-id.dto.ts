import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class GovernmentIdDto {
  @ApiProperty({ example: 'NIN' })
  @IsString()
  idType: string;

  @ApiProperty({ example: '12345678901' })
  @IsString()
  idNumber: string;
}
