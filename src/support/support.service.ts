import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TicketPriority, TicketStatus, UserRole } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const STAFF_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT_AGENT];

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // Creating a ticket also creates its first message — the ticket's own
  // opening description — so every ticket has at least one message.
  async createTicket(
    userId: string,
    dto: { subject: string; category: string; body: string; priority?: TicketPriority },
  ) {
    return this.prisma.supportTicket.create({
      data: {
        userId,
        subject: dto.subject,
        category: dto.category,
        priority: dto.priority,
        messages: { create: { authorId: userId, body: dto.body } },
      },
      include: { messages: true },
    });
  }

  async listMyTickets(userId: string, take = 50, skip = 0) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  async getTicket(userId: string, userRole: UserRole, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    this.assertCanView(userId, userRole, ticket.userId);
    return ticket;
  }

  async reply(userId: string, userRole: UserRole, ticketId: string, body: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    this.assertCanView(userId, userRole, ticket.userId);
    // RESOLVED and CLOSED both end the active thread — the plan's own
    // wording treats "resolve" as "close ticket" (one action, not two), so
    // both terminal statuses block further replies here.
    if (ticket.status === TicketStatus.RESOLVED || ticket.status === TicketStatus.CLOSED) {
      throw new ForbiddenException('This ticket is already resolved');
    }

    const isStaffReply = STAFF_ROLES.includes(userRole) && userId !== ticket.userId;
    const [message] = await this.prisma.$transaction([
      this.prisma.supportTicketMessage.create({ data: { ticketId, authorId: userId, body } }),
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: isStaffReply ? TicketStatus.IN_PROGRESS : ticket.status },
      }),
    ]);

    if (isStaffReply) {
      await this.notifications.send(
        ticket.userId,
        'SUPPORT',
        'New reply on your support ticket',
        body.length > 140 ? `${body.slice(0, 140)}…` : body,
      );
    }

    return message;
  }

  async listAllTickets(
    filters: { status?: TicketStatus; priority?: TicketPriority; assignedToId?: string },
    take = 50,
    skip = 0,
  ) {
    return this.prisma.supportTicket.findMany({
      where: filters,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  // Single PATCH surface for the admin dashboard — assign, change
  // priority, and/or transition status in one call. Terminal transitions
  // route through the dedicated methods so their side effects (resolution
  // message, escalation notification) still fire.
  async adminUpdate(
    ticketId: string,
    actorId: string,
    dto: {
      status?: TicketStatus;
      priority?: TicketPriority;
      assignedToId?: string;
      resolutionNote?: string;
      resolvedById?: string;
    },
  ) {
    await this.findTicketOrThrow(ticketId);

    if (dto.assignedToId) {
      await this.assertAssignee(dto.assignedToId);
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { assignedToId: dto.assignedToId },
      });
    }

    if (dto.priority) {
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { priority: dto.priority },
      });
    }

    if (dto.status === TicketStatus.RESOLVED || dto.status === TicketStatus.CLOSED) {
      return this.resolve(ticketId, actorId, dto.resolutionNote, dto.resolvedById);
    }
    if (dto.status === TicketStatus.ESCALATED) {
      return this.escalate(ticketId, actorId, dto.resolutionNote);
    }
    if (dto.status) {
      return this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: dto.status },
      });
    }

    return this.prisma.supportTicket.findUniqueOrThrow({ where: { id: ticketId } });
  }

  private async assertAssignee(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user || !STAFF_ROLES.includes(user.role)) {
      throw new NotFoundException('assignedToId is not a support/admin user');
    }
  }

  async assign(ticketId: string, assignedToId: string) {
    await this.findTicketOrThrow(ticketId);
    return this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { assignedToId, status: TicketStatus.IN_PROGRESS },
    });
  }

  async escalate(ticketId: string, actorId: string, reason?: string) {
    const ticket = await this.findTicketOrThrow(ticketId);
    const updated = await this.prisma.$transaction(async (tx) => {
      if (reason) {
        await tx.supportTicketMessage.create({
          data: { ticketId, authorId: actorId, body: `Escalated: ${reason}` },
        });
      }
      return tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: TicketStatus.ESCALATED,
          priority: TicketPriority.URGENT,
          escalatedAt: new Date(),
        },
      });
    });

    await this.notifications.send(
      ticket.userId,
      'SUPPORT',
      'Your support ticket has been escalated',
      'Your ticket is now being handled with higher priority.',
    );
    return updated;
  }

  async resolve(ticketId: string, actorId: string, resolutionNote?: string, resolvedById?: string) {
    const ticket = await this.findTicketOrThrow(ticketId);
    const resolver = resolvedById ?? actorId;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (resolutionNote) {
        await tx.supportTicketMessage.create({
          data: { ticketId, authorId: actorId, body: `Resolved: ${resolutionNote}` },
        });
      }
      return tx.supportTicket.update({
        where: { id: ticketId },
        data: { status: TicketStatus.RESOLVED, resolvedAt: new Date(), resolvedById: resolver },
      });
    });

    await this.notifications.send(
      ticket.userId,
      'SUPPORT',
      'Your support ticket has been resolved',
      resolutionNote ?? 'Your ticket has been marked as resolved.',
    );
    return updated;
  }

  private assertCanView(userId: string, userRole: UserRole, ticketOwnerId: string) {
    if (userId !== ticketOwnerId && !STAFF_ROLES.includes(userRole)) {
      throw new ForbiddenException('You are not a participant on this ticket');
    }
  }

  private async findTicketOrThrow(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    return ticket;
  }
}
