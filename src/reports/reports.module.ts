import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EmailModule } from '../integrations/email/email.module';
import { WalletModule } from '../wallet/wallet.module';
import { ReportsController } from './reports.controller';
import { ReportsProcessor } from './reports.processor';
import { REPORTS_QUEUE, ReportsService } from './reports.service';

@Module({
  imports: [WalletModule, EmailModule, BullModule.registerQueue({ name: REPORTS_QUEUE })],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsProcessor],
  exports: [],
})
export class ReportsModule {}
