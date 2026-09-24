import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TicketPriority, TicketStatus, UserRole } from '@prisma/client';
import { dateFilter } from '../common/dto/date-range-query.dto';
import {
  describeFilters,
  fullName,
  periodOf,
  resolveActorName,
} from '../common/export/export-helpers';
import { EXPORT_MAX_ROWS, ExportDocument } from '../common/export/export.types';
import { toPaginated } from '../common/utils/paginate.util';
import { tallyByStatus } from '../common/utils/tally.util';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExportTicketsQueryDto } from './dto/list-tickets-query.dto';

const STAFF_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT_AGENT];

// Tickets still needing staff attention.
const UNRESOLVED: TicketStatus[] = [
  TicketStatus.OPEN,
  TicketStatus.IN_PROGRESS,
  TicketStatus.ESCALATED,
];

const TICKET_PARTIES = {
  user: {
    select: { id: true, publicId: true, firstName: true, lastName: true, phone: true, email: true },
  },
  assignedTo: { select: { id: true, publicId: true, firstName: true, lastName: true } },
} as const;

interface TicketFilters {
  status?: TicketStatus;
  priority?: TicketPriority;
  assignedToId?: string;
  from?: string;
  to?: string;
}

function ticketWhere(filters: TicketFilters): Prisma.SupportTicketWhereInput {
  const createdAt = dateFilter(filters.from, filters.to);
  return {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.assignedToId ? { assignedToId: filters.assignedToId } : {}),
    ...(createdAt ? { createdAt } : {}),
  };
}

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

  async listAllTickets(filters: TicketFilters, take = 50, skip = 0) {
    const where = ticketWhere(filters);
    const [data, total, summary] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        include: TICKET_PARTIES,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.supportTicket.count({ where }),
      this.ticketSummary(),
    ]);
    return toPaginated(data, total, { take, skip }, summary);
  }

  /** Queue-wide counts for the stat cards — independent of page/filters. */
  async ticketSummary() {
    const [byStatus, urgentOpen, unassigned] = await Promise.all([
      this.prisma.supportTicket.groupBy({ by: ['status'], _count: true }),
      this.prisma.supportTicket.count({
        where: { priority: TicketPriority.URGENT, status: { in: UNRESOLVED } },
      }),
      this.prisma.supportTicket.count({
        where: { assignedToId: null, status: { in: UNRESOLVED } },
      }),
    ]);
    const t = tallyByStatus(byStatus);
    return {
      total: t.total,
      open: t[TicketStatus.OPEN] ?? 0,
      inProgress: t[TicketStatus.IN_PROGRESS] ?? 0,
      escalated: t[TicketStatus.ESCALATED] ?? 0,
      resolved: t[TicketStatus.RESOLVED] ?? 0,
      closed: t[TicketStatus.CLOSED] ?? 0,
      urgentOpen,
      unassigned,
    };
  }

  async exportTickets(query: ExportTicketsQueryDto, actorId: string): Promise<ExportDocument> {
    const where = ticketWhere(query);
    const [rows, total, byStatus, urgentOpen, generatedBy] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        include: TICKET_PARTIES,
        orderBy: { createdAt: 'desc' },
        take: EXPORT_MAX_ROWS,
      }),
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.supportTicket.count({
        where: { ...where, priority: TicketPriority.URGENT, status: { in: UNRESOLVED } },
      }),
      resolveActorName(this.prisma, actorId),
    ]);
    const t = tallyByStatus(byStatus);
    const hours = (r: (typeof rows)[number]) =>
      r.resolvedAt ? (r.resolvedAt.getTime() - r.createdAt.getTime()) / 3_600_000 : null;
    const resolved = rows.map(hours).filter((h): h is number => h !== null);

    return {
      title: 'Support Tickets Report',
      subtitle: 'Tickets with priority, assignee and resolution time',
      generatedBy,
      period: periodOf(query),
      filters: describeFilters({
        Status: query.status,
        Priority: query.priority,
        'Assigned to': query.assignedToId,
      }),
      summary: [
        {
          label: 'Total tickets',
          value: t.total,
          format: 'integer',
          note: 'Tickets matching the filters.',
        },
        {
          label: 'Open',
          value: t[TicketStatus.OPEN] ?? 0,
          format: 'integer',
          tone: 'warn',
          note: 'Waiting for a first response.',
        },
        {
          label: 'In progress',
          value: t[TicketStatus.IN_PROGRESS] ?? 0,
          format: 'integer',
          tone: 'info',
          note: 'Being worked on.',
        },
        {
          label: 'Escalated',
          value: t[TicketStatus.ESCALATED] ?? 0,
          format: 'integer',
          tone: 'bad',
          note: 'Escalated to a senior admin.',
        },
        {
          label: 'Resolved / closed',
          value: (t[TicketStatus.RESOLVED] ?? 0) + (t[TicketStatus.CLOSED] ?? 0),
          format: 'integer',
          tone: 'good',
          note: 'Finished tickets.',
        },
        {
          label: 'Urgent & unresolved',
          value: urgentOpen,
          format: 'integer',
          tone: 'bad',
          note: 'Priority URGENT and not yet resolved.',
        },
        {
          label: 'Avg. resolution time (hours)',
          value: resolved.length > 0 ? resolved.reduce((a, b) => a + b, 0) / resolved.length : null,
          format: 'number',
          note: 'Mean time from creation to resolution, over resolved tickets in this export.',
        },
      ],
      sections: [
        {
          name: 'Tickets',
          description: 'One row per ticket, newest first.',
          truncatedFrom: total > rows.length ? total : undefined,
          columns: [
            { key: 'ref', header: 'Ticket', width: 12 },
            { key: 'createdAt', header: 'Opened', format: 'datetime' },
            { key: 'subject', header: 'Subject', width: 36 },
            { key: 'category', header: 'Category', width: 16 },
            { key: 'status', header: 'Status', format: 'status' },
            { key: 'priority', header: 'Priority', format: 'status' },
            { key: 'requester', header: 'Requester', width: 22 },
            { key: 'assignee', header: 'Assigned to', width: 22 },
            { key: 'escalatedAt', header: 'Escalated', format: 'datetime' },
            { key: 'resolvedAt', header: 'Resolved', format: 'datetime' },
            { key: 'resolutionHours', header: 'Hours to resolve', format: 'number' },
          ],
          rows: rows.map((r) => ({
            ...r,
            ref: r.id.slice(0, 8),
            requester: fullName(r.user ?? {}) || '—',
            assignee: fullName(r.assignedTo ?? {}) || 'Unassigned',
            resolutionHours: hours(r),
          })),
        },
      ],
    };
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
