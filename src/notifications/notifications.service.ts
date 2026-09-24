import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, Prisma, UserRole } from '@prisma/client';
import { Queue } from 'bullmq';
import { toPaginated } from '../common/utils/paginate.util';
import { PrismaService } from '../prisma/prisma.service';
import { FcmService } from '../integrations/fcm/fcm.service';
import { ListNotificationHistoryQueryDto } from './dto/list-notification-history-query.dto';

export interface NotificationSegment {
  role?: UserRole;
  userIds?: string[];
}

export const NOTIFICATIONS_QUEUE = 'notifications';
export const FANOUT_JOB = 'fanout';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

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

  // For trip/payment events: a failed push must never fail the ride or
  // payment that triggered it, so this logs instead of throwing.
  notify(
    userId: string,
    category: string,
    title: string,
    body: string,
    metadata?: Prisma.InputJsonValue,
  ): void {
    this.send(userId, category, title, body, metadata).catch((err) =>
      this.logger.warn(`Failed to notify user ${userId} (${title}): ${err}`),
    );
  }

  async unreadCount(userId: string) {
    return { unread: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
  }

  async deleteNotification(userId: string, notificationId: string) {
    const result = await this.prisma.notification.deleteMany({
      where: { id: notificationId, userId },
    });
    return { deleted: result.count > 0 };
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

  async history(query: ListNotificationHistoryQueryDto) {
    const createdAt =
      query.from || query.to
        ? {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          }
        : undefined;

    const where: Prisma.NotificationCampaignWhereInput = {
      ...(query.category ? { category: query.category } : {}),
      ...(query.campaignId ? { id: query.campaignId } : {}),
      ...(createdAt ? { createdAt } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.notificationCampaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.take ?? 50,
        skip: query.skip ?? 0,
        include: { _count: { select: { notifications: true } } },
      }),
      this.prisma.notificationCampaign.count({ where }),
    ]);

    return toPaginated(data, total, query);
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
