import { ApiProperty } from '@nestjs/swagger';
import { IsPhoneNumber, IsString } from 'class-validator';

export class AppleCompleteSignupDto {
  @ApiProperty({
    description: 'Same (still-valid) ID token from the initial /auth/social/apple call',
  })
  @IsString()
  idToken: string;

  @ApiProperty({
    example: '+2348012345678',
    description: 'E.164 format — Apple never provides this',
  })
  @IsPhoneNumber()
  phone: string;

  // Required, unlike Google's equivalent field: Apple's ID token never
  // carries a name, on the first sign-in or any after — the client has to
  // capture it once from the native Sign in with Apple authorization
  // response and pass it through here.
  @ApiProperty({ example: 'Ada' })
  @IsString()
  firstName: string;

  @ApiProperty({ example: 'Obi' })
  @IsString()
  lastName: string;
}
