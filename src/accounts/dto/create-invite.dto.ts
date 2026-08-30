import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsEmail, IsUUID } from 'class-validator';

export class CreateInviteDto {
  @ApiProperty({ example: 'ngozi@kilo.africa' })
  @IsEmail()
  email: string;

  // The invitee fills in name/phone/password themselves at accept time —
  // sending an invite only needs to say who and what they'll be able to do.
  @ApiProperty({ type: [String], description: 'Fine-grained Role IDs to grant on acceptance' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  roleIds: string[];
}
