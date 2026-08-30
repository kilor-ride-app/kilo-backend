import { ApiProperty } from '@nestjs/swagger';
import { IsPhoneNumber, IsString, MinLength } from 'class-validator';

export class AcceptInviteDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty({ minLength: 8, example: 'a-strong-password' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'Ngozi' })
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Umeh' })
  @IsString()
  lastName: string;

  @ApiProperty({ example: '+2348012345678', description: 'E.164 format' })
  @IsPhoneNumber()
  phone: string;
}
