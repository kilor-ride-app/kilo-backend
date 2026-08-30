import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AttachDriverDto } from './dto/attach-driver.dto';
import { CreateFleetPartnerDto } from './dto/create-fleet-partner.dto';
import { CreatePartnerOfferDto } from './dto/create-partner-offer.dto';
import { EarningsQueryDto } from './dto/earnings-query.dto';
import { ListReferralsQueryDto } from './dto/list-referrals-query.dto';
import { UpdatePartnerOfferDto } from './dto/update-partner-offer.dto';
import { FleetPartnersService } from './fleet-partners.service';
import { PartnerOffersService } from './partner-offers.service';
import { ReferralsService } from './referrals.service';

@ApiTags('partnerships')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin')
export class AdminPartnershipsController {
  constructor(
    private readonly referrals: ReferralsService,
    private readonly fleetPartners: FleetPartnersService,
    private readonly partnerOffers: PartnerOffersService,
  ) {}

  @RequirePermissions('referrals.manage')
  @Get('referrals')
  listReferrals(@Query() query: ListReferralsQueryDto) {
    return this.referrals.listAll(query.status, query.take, query.skip);
  }

  @RequirePermissions('referrals.manage')
  @HttpCode(HttpStatus.OK)
  @Post('referrals/payouts')
  processReferralPayouts() {
    return this.referrals.processPayouts();
  }

  @RequirePermissions('fleet-partners.manage')
  @Post('fleet-partners')
  createFleetPartner(@Body() dto: CreateFleetPartnerDto) {
    return this.fleetPartners.create(dto);
  }

  @RequirePermissions('fleet-partners.manage')
  @Get('fleet-partners')
  listFleetPartners() {
    return this.fleetPartners.list();
  }

  @RequirePermissions('fleet-partners.manage')
  @Get('fleet-partners/:id')
  getFleetPartner(@Param('id') id: string) {
    return this.fleetPartners.getDetail(id);
  }

  @RequirePermissions('fleet-partners.manage')
  @Post('fleet-partners/:id/drivers')
  attachDriver(@Param('id') id: string, @Body() dto: AttachDriverDto) {
    return this.fleetPartners.attachDriver(id, dto.driverId);
  }

  @RequirePermissions('fleet-partners.manage')
  @Get('fleet-partners/:id/drivers')
  listFleetDrivers(@Param('id') id: string) {
    return this.fleetPartners.listDrivers(id);
  }

  @RequirePermissions('fleet-partners.manage')
  @Get('fleet-partners/:id/earnings')
  getFleetEarnings(@Param('id') id: string, @Query() query: EarningsQueryDto) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return this.fleetPartners.getEarnings(id, from, to);
  }

  @RequirePermissions('partner-offers.manage')
  @Post('partner-offers')
  createPartnerOffer(@Body() dto: CreatePartnerOfferDto) {
    return this.partnerOffers.create(dto);
  }

  @RequirePermissions('partner-offers.manage')
  @Patch('partner-offers/:id')
  updatePartnerOffer(@Param('id') id: string, @Body() dto: UpdatePartnerOfferDto) {
    return this.partnerOffers.update(id, dto);
  }

  @RequirePermissions('partner-offers.manage')
  @Get('partner-offers/:id/claims')
  getPartnerOfferClaims(@Param('id') id: string) {
    return this.partnerOffers.getClaims(id);
  }
}
