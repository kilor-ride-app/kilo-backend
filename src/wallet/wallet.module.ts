import { Module } from '@nestjs/common';
import { PaystackModule } from '../integrations/paystack/paystack.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { WalletHistoryService } from './wallet-history.service';
import { AdminFinanceService } from './admin-finance.service';
import { AdminWalletController } from './admin-wallet.controller';
import { PaymentsService } from './payments.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { WalletWebhooksController } from './wallet-webhooks.controller';

@Module({
  imports: [PaystackModule, PlatformConfigModule, NotificationsModule],
  controllers: [WalletController, AdminWalletController, WalletWebhooksController],
  providers: [WalletService, PaymentsService, AdminFinanceService, WalletHistoryService],
  exports: [WalletService],
})
export class WalletModule {}
