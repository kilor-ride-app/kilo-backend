import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../integrations/email/email.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminBusinessController } from './admin-business.controller';
import { BusinessInvoicesService } from './business-invoices.service';
import { BusinessInvitesController } from './business-invites.controller';
import { BusinessController } from './business.controller';
import { BusinessService } from './business.service';

@Module({
  imports: [WalletModule, EmailModule, AccountsModule, LogisticsModule, AuditModule],
  controllers: [BusinessController, BusinessInvitesController, AdminBusinessController],
  providers: [BusinessService, BusinessInvoicesService],
  exports: [],
})
export class BusinessModule {}
