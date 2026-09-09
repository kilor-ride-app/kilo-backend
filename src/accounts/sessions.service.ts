import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { describeUserAgent } from '../common/utils/user-agent.util';

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, currentSessionId?: string) {
    const tokens = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }],
    });

    return tokens.map((t) => {
      const device = describeUserAgent(t.userAgent);
      return {
        id: t.id,
        deviceName: t.deviceLabel ?? device.deviceLabel,
        deviceType: device.deviceType,
        browser: device.browser,
        os: device.os,
        ipAddress: t.ipAddress,
        // Reverse-geocoding an IP needs a geo-IP provider we don't have yet.
        location: null,
        lastActiveAt: t.lastUsedAt ?? t.createdAt,
        createdAt: t.createdAt,
        isCurrentSession: currentSessionId ? t.id === currentSessionId : false,
      };
    });
  }

  async revoke(userId: string, sessionId: string) {
    const token = await this.prisma.refreshToken.findUnique({ where: { id: sessionId } });
    if (!token || token.userId !== userId) {
      throw new NotFoundException('Session not found');
    }
    if (token.revokedAt) {
      return { revoked: true };
    }
    await this.prisma.refreshToken.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
  }

  async revokeAllOthers(userId: string, currentSessionId?: string) {
    if (!currentSessionId) {
      throw new ForbiddenException(
        'Current session could not be identified — sign in again and retry',
      );
    }
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null, id: { not: currentSessionId } },
      data: { revokedAt: new Date() },
    });
    return { revokedCount: result.count };
  }
}
