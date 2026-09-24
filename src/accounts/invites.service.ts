import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InviteStatus, UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../integrations/email/email.service';
import { generateSecureToken, hashToken } from '../common/utils/token.util';
import { AuthService, TokenPair } from './auth.service';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly authService: AuthService,
  ) {}

  async createInvite(inviterId: string, dto: { email: string; roleIds: string[] }) {
    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) {
      throw new ConflictException('An account with this email already exists');
    }

    const pendingInvite = await this.prisma.staffInvite.findFirst({
      where: { email: dto.email, status: InviteStatus.PENDING, expiresAt: { gt: new Date() } },
    });
    if (pendingInvite) {
      throw new ConflictException('An invite is already pending for this email — revoke it first');
    }

    const roles = await this.prisma.role.findMany({ where: { id: { in: dto.roleIds } } });
    if (roles.length !== dto.roleIds.length) {
      throw new BadRequestException('One or more role IDs were not found');
    }

    const rawToken = generateSecureToken();
    const invite = await this.prisma.staffInvite.create({
      data: {
        email: dto.email,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedById: inviterId,
        roles: { connect: roles.map((r) => ({ id: r.id })) },
      },
      include: { roles: true },
    });

    // The DB write and the email aren't one transaction. If the email
    // fails, roll the row back so the admin can simply retry instead of
    // hitting "an invite is already pending" with no email ever sent.
    await this.dispatchInviteEmail(
      dto.email,
      roles.map((r) => r.name),
      rawToken,
    ).catch(async (err) => {
      await this.prisma.staffInvite.delete({ where: { id: invite.id } }).catch(() => undefined);
      this.logger.error(`Staff invite email to ${dto.email} failed — invite rolled back`, err);
      throw new ServiceUnavailableException(
        'Invitation email could not be delivered — please try again',
      );
    });

    return {
      id: invite.id,
      email: invite.email,
      roles: invite.roles.map((r) => r.name),
      expiresAt: invite.expiresAt,
    };
  }

  // Regenerates the token, extends the expiry, and re-sends the email for a
  // still-pending invite. On email failure the existing row is left intact
  // (unlike createInvite, there's nothing new to roll back).
  async resendInvite(id: string) {
    const invite = await this.prisma.staffInvite.findUnique({
      where: { id },
      include: { roles: true },
    });
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }
    if (invite.status !== InviteStatus.PENDING) {
      throw new BadRequestException('Only pending invites can be resent');
    }

    const rawToken = generateSecureToken();
    const updated = await this.prisma.staffInvite.update({
      where: { id },
      data: {
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
      include: { roles: true },
    });

    await this.dispatchInviteEmail(
      updated.email,
      updated.roles.map((r) => r.name),
      rawToken,
    ).catch((err) => {
      this.logger.error(`Staff invite resend to ${updated.email} failed`, err);
      throw new ServiceUnavailableException(
        'Invitation email could not be delivered — please try again',
      );
    });

    return {
      id: updated.id,
      email: updated.email,
      roles: updated.roles.map((r) => r.name),
      expiresAt: updated.expiresAt,
    };
  }

  private async dispatchInviteEmail(email: string, roleNames: string[], rawToken: string) {
    const acceptUrl = `${this.config.get<string>('ADMIN_APP_URL') ?? 'http://localhost:5174'}/invite/accept?token=${rawToken}`;
    await this.email.sendStaffInvite(
      email,
      roleNames,
      acceptUrl,
      INVITE_TTL_MS / (24 * 60 * 60 * 1000),
    );
  }

  async listInvites() {
    return this.prisma.staffInvite.findMany({
      select: {
        id: true,
        email: true,
        status: true,
        expiresAt: true,
        revokedAt: true,
        acceptedAt: true,
        createdAt: true,
        roles: { select: { id: true, name: true } },
        invitedBy: { select: { id: true, publicId: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeInvite(id: string) {
    const invite = await this.prisma.staffInvite.findUnique({ where: { id } });
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }
    if (invite.status !== InviteStatus.PENDING) {
      throw new BadRequestException('Only pending invites can be revoked');
    }
    await this.prisma.staffInvite.update({
      where: { id },
      data: { status: InviteStatus.REVOKED, revokedAt: new Date() },
    });
    return { message: 'Invite revoked' };
  }

  async acceptInvite(dto: {
    token: string;
    password: string;
    firstName: string;
    lastName: string;
    phone: string;
  }): Promise<TokenPair> {
    const invite = await this.prisma.staffInvite.findUnique({
      where: { tokenHash: hashToken(dto.token) },
      include: { roles: true },
    });
    if (!invite) {
      throw new UnauthorizedException('Invalid invite');
    }
    if (invite.status !== InviteStatus.PENDING || invite.expiresAt < new Date()) {
      throw new UnauthorizedException('This invite is no longer valid');
    }

    const phoneTaken = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (phoneTaken) {
      throw new ConflictException('An account with this phone number already exists');
    }

    const passwordHash = await argon2.hash(dto.password);
    // Every account created through this flow is coarse-tier ADMIN — the
    // Role/Permission grants below (not a separate coarse choice) are what
    // actually scope what they can do.
    const user = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        email: invite.email,
        // Receiving and clicking the invite link already proves ownership
        // of this inbox — no separate verification round-trip needed.
        emailVerifiedAt: new Date(),
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        staffRoles: { connect: invite.roles.map((r) => ({ id: r.id })) },
      },
    });

    await this.prisma.staffInvite.update({
      where: { id: invite.id },
      data: { status: InviteStatus.ACCEPTED, acceptedAt: new Date(), acceptedUserId: user.id },
    });

    return this.authService.issueTokenPair(user.id, user.role, user.phone);
  }
}
