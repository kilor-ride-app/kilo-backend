import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import {
  NOTIFICATIONS_QUEUE,
  NotificationSegment,
  NotificationsService,
} from './notifications.service';

// Whole fan-out runs as one job for this pass, not one job per recipient —
// simpler, fine for MVP campaign sizes. A genuinely large broadcast would
// want to shard into per-user jobs so one slow recipient can't stall the
// rest; revisit if campaign audiences grow into the thousands.
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<{ campaignId: string }>) {
    const campaign = await this.prisma.notificationCampaign.findUniqueOrThrow({
      where: { id: job.data.campaignId },
    });
    const segment = campaign.segment as NotificationSegment;

    const users = await this.prisma.user.findMany({
      where: segment.userIds?.length
        ? { id: { in: segment.userIds } }
        : segment.role
          ? { role: segment.role }
          : {},
      select: { id: true },
    });

    this.logger.log(`Fanning out campaign ${campaign.id} to ${users.length} recipient(s)`);
    for (const user of users) {
      await this.notifications.send(
        user.id,
        campaign.category,
        campaign.title,
        campaign.body,
        undefined,
        campaign.id,
      );
    }

    await this.prisma.notificationCampaign.update({
      where: { id: campaign.id },
      data: { sentAt: new Date() },
    });
  }
}
