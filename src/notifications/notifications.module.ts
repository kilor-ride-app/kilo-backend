import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { FcmModule } from '../integrations/fcm/fcm.module';
import { AdminNotificationsController } from './admin-notifications.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsProcessor } from './notifications.processor';
import { NOTIFICATIONS_QUEUE, NotificationsService } from './notifications.service';

@Module({
  imports: [FcmModule, BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })],
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [NotificationsService, NotificationsProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}
