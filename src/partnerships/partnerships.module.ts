import { Module } from '@nestjs/common';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminPartnershipsController } from './admin-partnerships.controller';
import { FleetPartnersService } from './fleet-partners.service';
import { PartnerOffersService } from './partner-offers.service';
import { PartnershipsController } from './partnerships.controller';
import { ReferralsService } from './referrals.service';

@Module({
  imports: [WalletModule, PlatformConfigModule],
  controllers: [PartnershipsController, AdminPartnershipsController],
  providers: [ReferralsService, FleetPartnersService, PartnerOffersService],
  exports: [],
})
export class PartnershipsModule {}
