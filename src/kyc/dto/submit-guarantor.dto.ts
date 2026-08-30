import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class SubmitGuarantorDto {
  @ApiProperty({ example: 'Ngozi Umeh' })
  @IsString()
  fullName: string;

  @ApiProperty({ example: 'Employer' })
  @IsString()
  relationship: string;

  @ApiProperty({ example: '14 Adeola Odeku Street, Victoria Island, Lagos' })
  @IsString()
  address: string;

  @ApiProperty({ example: 'Civil Servant' })
  @IsString()
  occupation: string;

  @ApiProperty({ example: 'NIN' })
  @IsString()
  idType: string;

  @ApiProperty({ example: '12345678901' })
  @IsString()
  idNumber: string;
}
