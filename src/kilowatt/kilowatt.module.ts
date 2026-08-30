import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { AdminKilowattController } from './admin-kilowatt.controller';
import { BatterySwapService } from './battery-swap.service';
import { ChargingStationsService } from './charging-stations.service';
import { KilowattController } from './kilowatt.controller';
import { SolarAssessmentsService } from './solar-assessments.service';

@Module({
  imports: [WalletModule],
  controllers: [KilowattController, AdminKilowattController],
  providers: [ChargingStationsService, BatterySwapService, SolarAssessmentsService],
  exports: [],
})
export class KilowattModule {}
