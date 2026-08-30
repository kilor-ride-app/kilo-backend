import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AcceptInviteDto } from '../accounts/dto/accept-invite.dto';
import { BusinessService } from './business.service';

const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

// Public — no auth, mirrors POST /auth/invites/accept exactly (same DTO
// shape: token + self-supplied name/phone/password). Kept in its own
// unguarded controller rather than BusinessController, which requires a
// JWT for every other route.
@ApiTags('business')
@Controller('business/invites')
export class BusinessInvitesController {
  constructor(private readonly business: BusinessService) {}

  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('accept')
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.business.acceptInvite(dto);
  }
}
