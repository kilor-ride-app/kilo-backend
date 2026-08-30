import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { ChangeEmailDto } from './dto/change-email.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { EmailVerificationService } from './email-verification.service';
import { UsersService } from './users.service';

const EMAIL_OTP_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('accounts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getProfile(user.userId);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.userId, dto);
  }

  // Sets/changes email as `pendingEmail` and sends a code to it — `email`
  // itself only updates once POST /users/me/email/verify succeeds.
  @Throttle(EMAIL_OTP_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('me/email')
  changeEmail(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangeEmailDto) {
    return this.emailVerification.requestChange(user.userId, dto.email);
  }

  @Throttle(EMAIL_OTP_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('me/email/verify')
  verifyEmail(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifyEmailDto) {
    return this.emailVerification.confirm(user.userId, dto.code);
  }
}
