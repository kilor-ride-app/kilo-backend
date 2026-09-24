import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { AuthService } from './auth.service';
import { ChangeEmailDto } from './dto/change-email.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { NextOfKinDto } from './dto/next-of-kin.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { EmailVerificationService } from './email-verification.service';
import { SessionsService } from './sessions.service';
import { UsersService } from './users.service';

const EMAIL_OTP_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
const PASSWORD_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

const AVATAR_VALIDATORS = new ParseFilePipe({
  validators: [
    new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
    new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ }),
  ],
});

@ApiTags('accounts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly emailVerification: EmailVerificationService,
    private readonly sessions: SessionsService,
    private readonly authService: AuthService,
  ) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getProfile(user.userId);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.userId, dto);
  }

  // Emergency contact — the profile response carries nextOfKinName/Phone,
  // so there is no separate GET.
  @Put('me/next-of-kin')
  setNextOfKin(@CurrentUser() user: AuthenticatedUser, @Body() dto: NextOfKinDto) {
    return this.usersService.setNextOfKin(user.userId, dto.fullName, dto.phone);
  }

  @HttpCode(HttpStatus.OK)
  @Delete('me/next-of-kin')
  clearNextOfKin(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.clearNextOfKin(user.userId);
  }

  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @Post('me/avatar')
  setAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile(AVATAR_VALIDATORS) file: Express.Multer.File,
  ) {
    return this.usersService.setAvatar(user.userId, file);
  }

  @Throttle(PASSWORD_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('me/password')
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.userId, dto, user.sid);
  }

  @Get('me/sessions')
  listSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.sessions.list(user.userId, user.sid);
  }

  @HttpCode(HttpStatus.OK)
  @Delete('me/sessions/all-other')
  revokeOtherSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.sessions.revokeAllOthers(user.userId, user.sid);
  }

  @HttpCode(HttpStatus.OK)
  @Delete('me/sessions/:id')
  revokeSession(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sessions.revoke(user.userId, id);
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
