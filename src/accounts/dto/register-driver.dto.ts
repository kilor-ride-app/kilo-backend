import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsPhoneNumber, IsString, MinLength } from 'class-validator';

export class RegisterDriverDto {
  @ApiProperty({ example: 'Chidi' })
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Eze' })
  @IsString()
  lastName: string;

  @ApiProperty({ example: '+2348012345678', description: 'E.164 format' })
  @IsPhoneNumber()
  phone: string;

  @ApiProperty({ example: 'chidi@example.com', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ minLength: 8, example: 'a-strong-password' })
  @IsString()
  @MinLength(8)
  password: string;
}
