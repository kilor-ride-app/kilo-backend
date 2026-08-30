import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { RedeemReferralDto } from './dto/redeem-referral.dto';
import { PartnerOffersService } from './partner-offers.service';
import { ReferralsService } from './referrals.service';

@ApiTags('partnerships')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller()
export class PartnershipsController {
  constructor(
    private readonly referrals: ReferralsService,
    private readonly partnerOffers: PartnerOffersService,
  ) {}

  @Post('referrals/generate')
  generateReferralCode(@CurrentUser() user: AuthenticatedUser) {
    return this.referrals.generateCode(user.userId);
  }

  @Get('referrals/me')
  myReferralStats(@CurrentUser() user: AuthenticatedUser) {
    return this.referrals.myStats(user.userId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('referrals/redeem')
  redeemReferral(@CurrentUser() user: AuthenticatedUser, @Body() dto: RedeemReferralDto) {
    return this.referrals.redeem(user.userId, dto.code);
  }

  @Get('partner-offers')
  listPartnerOffers(@CurrentUser() user: AuthenticatedUser) {
    return this.partnerOffers.list(user.role);
  }

  @Get('partner-offers/:id')
  getPartnerOffer(@Param('id') id: string) {
    return this.partnerOffers.getDetail(id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('partner-offers/:id/claim')
  claimPartnerOffer(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.partnerOffers.claim(id, user.userId);
  }
}
