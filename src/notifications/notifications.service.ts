import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { NotificationChannel, Prisma, UserRole } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { FcmService } from '../integrations/fcm/fcm.service';

export interface NotificationSegment {
  role?: UserRole;
  userIds?: string[];
}

export const NOTIFICATIONS_QUEUE = 'notifications';
export const FANOUT_JOB = 'fanout';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm: FcmService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  // The one place a notification actually gets created — records the
  // in-app row unconditionally (that's the notification list itself), and
  // attempts push only if enabled and the driver/rider has a device
  // registered. Push failure never blocks or fails this call.
  async send(
    userId: string,
    category: string,
    title: string,
    body: string,
    metadata?: Prisma.InputJsonValue,
    campaignId?: string,
  ) {
    const notification = await this.prisma.notification.create({
      data: { userId, category, title, body, metadata, campaignId },
    });

    const pushEnabled = await this.isChannelEnabled(userId, category, NotificationChannel.PUSH);
    if (pushEnabled) {
      const tokens = await this.prisma.deviceToken.findMany({ where: { userId } });
      if (tokens.length > 0) {
        const result = await this.fcm.sendToTokens(
          tokens.map((t) => t.token),
          title,
          body,
        );
        if (result.invalidTokens.length > 0) {
          await this.prisma.deviceToken.deleteMany({
            where: { token: { in: result.invalidTokens } },
          });
        }
      }
    }

    return notification;
  }

  async listNotifications(userId: string, take = 50, skip = 0) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  async markRead(userId: string, notificationId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
    return { updated: result.count > 0 };
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  // Opt-out model: any (category, channel) pair with no row is enabled by
  // default, so a brand-new category never silently un-subscribes anyone.
  async getPreferences(userId: string) {
    return this.prisma.notificationPreference.findMany({ where: { userId } });
  }

  async updatePreferences(
    userId: string,
    updates: { category: string; channel: NotificationChannel; enabled: boolean }[],
  ) {
    await this.prisma.$transaction(
      updates.map((u) =>
        this.prisma.notificationPreference.upsert({
          where: { userId_category_channel: { userId, category: u.category, channel: u.channel } },
          update: { enabled: u.enabled },
          create: { userId, category: u.category, channel: u.channel, enabled: u.enabled },
        }),
      ),
    );
    return this.getPreferences(userId);
  }

  async registerDevice(userId: string, token: string, platform: string) {
    return this.prisma.deviceToken.upsert({
      where: { token },
      update: { userId, platform },
      create: { userId, token, platform },
    });
  }

  async unregisterDevice(userId: string, token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token, userId } });
    return { message: 'Device unregistered' };
  }

  // Broadcast/targeted both just create a campaign with a segment and hand
  // fan-out to BullMQ — plan.md Section 11: notification fan-out shouldn't
  // run on the request path.
  async broadcast(createdById: string, title: string, body: string, category: string) {
    return this.createCampaign(createdById, title, body, category, {});
  }

  async targeted(
    createdById: string,
    title: string,
    body: string,
    category: string,
    segment: NotificationSegment,
  ) {
    return this.createCampaign(createdById, title, body, category, segment);
  }

  async schedule(
    createdById: string,
    title: string,
    body: string,
    category: string,
    segment: NotificationSegment,
    scheduledFor: Date,
  ) {
    return this.createCampaign(createdById, title, body, category, segment, scheduledFor);
  }

  async history(take = 50, skip = 0) {
    return this.prisma.notificationCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: { _count: { select: { notifications: true } } },
    });
  }

  private async createCampaign(
    createdById: string,
    title: string,
    body: string,
    category: string,
    segment: NotificationSegment,
    scheduledFor?: Date,
  ) {
    const campaign = await this.prisma.notificationCampaign.create({
      data: {
        title,
        body,
        category,
        segment: segment as Prisma.InputJsonValue,
        createdById,
        scheduledFor,
      },
    });

    const delay = scheduledFor ? Math.max(0, scheduledFor.getTime() - Date.now()) : 0;
    await this.queue.add(FANOUT_JOB, { campaignId: campaign.id }, { delay });

    return campaign;
  }

  private async isChannelEnabled(
    userId: string,
    category: string,
    channel: NotificationChannel,
  ): Promise<boolean> {
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { userId_category_channel: { userId, category, channel } },
    });
    return pref?.enabled ?? true;
  }
}
