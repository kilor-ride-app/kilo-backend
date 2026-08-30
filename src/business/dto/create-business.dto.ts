import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsPhoneNumber, IsString } from 'class-validator';

export class CreateBusinessDto {
  @ApiProperty({ example: 'Kilo Logistics Ltd' })
  @IsString()
  name: string;

  @ApiProperty({ required: false, example: 'RC1234567' })
  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiProperty({ required: false, example: '+2348012345678' })
  @IsOptional()
  @IsPhoneNumber()
  contactPhone?: string;
}
