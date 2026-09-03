import { Module } from '@nestjs/common';
import { PaystackModule } from '../integrations/paystack/paystack.module';
import { AdminFinanceService } from './admin-finance.service';
import { AdminWalletController } from './admin-wallet.controller';
import { PaymentsService } from './payments.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { WalletWebhooksController } from './wallet-webhooks.controller';

@Module({
  imports: [PaystackModule],
  controllers: [WalletController, AdminWalletController, WalletWebhooksController],
  providers: [WalletService, PaymentsService, AdminFinanceService],
  exports: [WalletService],
})
export class WalletModule {}
