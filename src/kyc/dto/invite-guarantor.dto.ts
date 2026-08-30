import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsPhoneNumber, IsString, ValidateIf } from 'class-validator';

export class InviteGuarantorDto {
  @ApiProperty({ example: 'Ngozi Umeh' })
  @IsString()
  fullName: string;

  @ApiProperty({ required: false, example: 'guarantor@example.com' })
  @ValidateIf((dto: InviteGuarantorDto) => !dto.phone)
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false, example: '+2348012345678', description: 'E.164 format' })
  @ValidateIf((dto: InviteGuarantorDto) => !dto.email)
  @IsPhoneNumber()
  phone?: string;
}
