import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VerifyReceiverOtpDto } from './dto/verify-receiver-otp.dto';
import { LogisticsService } from './logistics.service';

// No auth at all — the trackingToken itself is the credential (matches
// main.ts's global-prefix exclusion for this exact route shape). Never
// expose package value, fare, or the sender's identity here.
@ApiTags('logistics')
@Controller('track')
export class PublicTrackingController {
  constructor(private readonly logistics: LogisticsService) {}

  @Get(':trackingToken')
  track(@Param('trackingToken') trackingToken: string) {
    return this.logistics.trackDelivery(trackingToken);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':trackingToken/otp/verify')
  verifyOtp(@Param('trackingToken') trackingToken: string, @Body() dto: VerifyReceiverOtpDto) {
    return this.logistics.verifyReceiverOtp(trackingToken, dto.code);
  }
}
