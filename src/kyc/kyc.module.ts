import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../integrations/email/email.module';
import { R2Module } from '../integrations/r2/r2.module';
import { SmileIdentityModule } from '../integrations/smile-identity/smile-identity.module';
import { SmsModule } from '../integrations/sms/sms.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminGuarantorController } from './admin-guarantor.controller';
import { AdminKycController } from './admin-kyc.controller';
import { GuarantorService } from './guarantor.service';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { PublicGuarantorController } from './public-guarantor.controller';

@Module({
  imports: [
    R2Module,
    SmileIdentityModule,
    AuditModule,
    EmailModule,
    SmsModule,
    NotificationsModule,
  ],
  controllers: [
    KycController,
    AdminKycController,
    PublicGuarantorController,
    AdminGuarantorController,
  ],
  providers: [KycService, GuarantorService],
  exports: [KycService],
})
export class KycModule {}
