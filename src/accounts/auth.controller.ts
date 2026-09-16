import { Body, Controller, Headers, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { InvitesService } from './invites.service';
import { RegisterRiderDto } from './dto/register-rider.dto';
import { RegisterDriverDto } from './dto/register-driver.dto';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

// Tighter than the global default limit — OTP-bombing and credential
// stuffing are the most-attacked endpoints on any ride-hailing platform
// (plan.md Section 7).
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('accounts')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly invitesService: InvitesService,
  ) {}

  @Post('riders/register')
  registerRider(@Body() dto: RegisterRiderDto) {
    return this.authService.registerRider(dto);
  }

  @Post('drivers/register')
  registerDriver(@Body() dto: RegisterDriverDto) {
    return this.authService.registerDriver(dto);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('otp/send')
  sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto.phone, dto.purpose);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto, @Ip() ip: string, @Headers('user-agent') userAgent: string) {
    return this.authService.verifyOtp(dto.phone, dto.code, dto.purpose, { ip, userAgent });
  }

  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto, @Ip() ip: string, @Headers('user-agent') userAgent: string) {
    return this.authService.login(dto.identifier, dto.password, { ip, userAgent });
  }

  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('password/forgot')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.identifier);
  }

  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('password/reset')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('token/refresh')
  refresh(
    @Body() dto: RefreshTokenDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.authService.refresh(dto.refreshToken, { ip, userAgent });
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('invites/accept')
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.invitesService.acceptInvite(dto);
  }
}
