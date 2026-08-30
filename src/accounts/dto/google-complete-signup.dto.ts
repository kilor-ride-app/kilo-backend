import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsPhoneNumber, IsString } from 'class-validator';

export class GoogleCompleteSignupDto {
  @ApiProperty({
    description: 'Same (still-valid) ID token from the initial /auth/social/google call',
  })
  @IsString()
  idToken: string;

  @ApiProperty({
    example: '+2348012345678',
    description: 'E.164 format — Google never provides this',
  })
  @IsPhoneNumber()
  phone: string;

  // Google reliably includes given_name/family_name in the ID token, but
  // these let the client override or fill a gap on the rare account that omits them.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  lastName?: string;
}
