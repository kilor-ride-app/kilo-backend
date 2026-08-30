import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AppleAuthDto } from './dto/apple-auth.dto';
import { AppleCompleteSignupDto } from './dto/apple-complete-signup.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { GoogleCompleteSignupDto } from './dto/google-complete-signup.dto';
import { SocialAuthService } from './social-auth.service';

// Token verification calls out to Google/Apple's key endpoints — worth the
// same protection as the password/OTP auth routes.
const SOCIAL_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('accounts')
@Controller('auth/social')
export class SocialAuthController {
  constructor(private readonly socialAuth: SocialAuthService) {}

  @Throttle(SOCIAL_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('google')
  authenticateGoogle(@Body() dto: GoogleAuthDto) {
    return this.socialAuth.authenticateGoogle(dto.idToken);
  }

  @Throttle(SOCIAL_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('google/complete')
  completeGoogleSignup(@Body() dto: GoogleCompleteSignupDto) {
    return this.socialAuth.completeGoogleSignup(
      dto.idToken,
      dto.phone,
      dto.firstName,
      dto.lastName,
    );
  }

  @Throttle(SOCIAL_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('apple')
  authenticateApple(@Body() dto: AppleAuthDto) {
    return this.socialAuth.authenticateApple(dto.idToken);
  }

  @Throttle(SOCIAL_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('apple/complete')
  completeAppleSignup(@Body() dto: AppleCompleteSignupDto) {
    return this.socialAuth.completeAppleSignup(dto.idToken, dto.phone, dto.firstName, dto.lastName);
  }
}
