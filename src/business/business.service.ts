import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountType,
  BusinessStatus,
  InvoiceStatus,
  InviteStatus,
  Prisma,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../integrations/email/email.service';
import { AuthService, TokenPair } from '../accounts/auth.service';
import { generateSecureToken, hashToken } from '../common/utils/token.util';
import { describeFilters, resolveActorName } from '../common/export/export-helpers';
import { EXPORT_MAX_ROWS, ExportDocument } from '../common/export/export.types';
import { toPaginated } from '../common/utils/paginate.util';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import {
  CreditStatus,
  ExportBusinessesQueryDto,
  ListBusinessesQueryDto,
} from './dto/list-businesses-query.dto';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class BusinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly authService: AuthService,
    private readonly audit: AuditService,
  ) {}

  // Any RIDER can start a company account — a one-way upgrade, same
  // pattern as invite-acceptance assigning ADMIN. A user can only own/
  // belong to one business in this pass.
  async createBusiness(
    userId: string,
    dto: {
      name: string;
      registrationNumber?: string;
      contactEmail?: string;
      contactPhone?: string;
    },
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role !== UserRole.RIDER) {
      throw new ForbiddenException('Only a rider account can create a business account');
    }
    if (user.businessId) {
      throw new ConflictException('You already belong to a business');
    }

    return this.prisma.$transaction(async (tx) => {
      const business = await tx.business.create({ data: dto });
      await tx.user.update({
        where: { id: userId },
        data: { role: UserRole.BUSINESS_ADMIN, businessId: business.id },
      });
      return business;
    });
  }

  async getBusiness(userId: string, businessId: string) {
    await this.assertMember(userId, businessId);
    return this.prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  }

  async inviteTeamMember(
    inviterId: string,
    businessId: string,
    dto: { email: string; role: UserRole },
  ) {
    await this.assertAdmin(inviterId, businessId);

    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) {
      throw new ConflictException('An account with this email already exists');
    }
    const pending = await this.prisma.businessTeamInvite.findFirst({
      where: {
        businessId,
        email: dto.email,
        status: InviteStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
    });
    if (pending) {
      throw new ConflictException('An invite is already pending for this email — revoke it first');
    }

    const business = await this.prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    const rawToken = generateSecureToken();
    const invite = await this.prisma.businessTeamInvite.create({
      data: {
        businessId,
        email: dto.email,
        role: dto.role,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedById: inviterId,
      },
    });

    const acceptUrl = `${this.config.get<string>('BUSINESS_APP_URL') ?? 'http://localhost:5175'}/invite/accept?token=${rawToken}`;
    await this.email.sendBusinessTeamInvite(
      dto.email,
      business.name,
      acceptUrl,
      INVITE_TTL_MS / (24 * 60 * 60 * 1000),
    );

    return { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt };
  }

  async listTeamMembers(userId: string, businessId: string) {
    await this.assertMember(userId, businessId);
    return this.prisma.user.findMany({
      where: { businessId },
      select: {
        id: true,
        publicId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
      },
    });
  }

  async removeTeamMember(actorId: string, businessId: string, targetUserId: string) {
    await this.assertAdmin(actorId, businessId);
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target || target.businessId !== businessId) {
      throw new NotFoundException('Team member not found');
    }

    // Downgrades back to a plain rider account rather than deleting it —
    // their ride/order history stays intact, they just lose business access.
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { businessId: null, role: UserRole.RIDER },
    });
    return { removed: true };
  }

  async acceptInvite(dto: {
    token: string;
    password: string;
    firstName: string;
    lastName: string;
    phone: string;
  }): Promise<TokenPair> {
    const invite = await this.prisma.businessTeamInvite.findUnique({
      where: { tokenHash: hashToken(dto.token) },
    });
    if (!invite) {
      throw new BadRequestException('Invalid invite');
    }
    if (invite.status !== InviteStatus.PENDING || invite.expiresAt < new Date()) {
      throw new BadRequestException('This invite is no longer valid');
    }
    const phoneTaken = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (phoneTaken) {
      throw new ConflictException('An account with this phone number already exists');
    }

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          email: invite.email,
          emailVerifiedAt: new Date(),
          passwordHash,
          role: invite.role,
          status: UserStatus.ACTIVE,
          businessId: invite.businessId,
        },
      });
      await tx.businessTeamInvite.update({
        where: { id: invite.id },
        data: { status: InviteStatus.ACCEPTED, acceptedAt: new Date(), acceptedUserId: created.id },
      });
      return created;
    });

    return this.authService.issueTokenPair(user.id, user.role, user.phone);
  }

  async getCredit(userId: string, businessId: string) {
    await this.assertMember(userId, businessId);
    const [business, payable] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({ where: { id: businessId } }),
      this.wallet.getOrCreateUserAccount(businessId, AccountType.BUSINESS_CREDIT_PAYABLE),
    ]);
    return { creditLimit: business.creditLimit, outstanding: payable.balance };
  }

  async setCreditLimit(businessId: string, creditLimit: Prisma.Decimal | number) {
    await this.prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    return this.prisma.business.update({ where: { id: businessId }, data: { creditLimit } });
  }

  async setStatus(businessId: string, status: BusinessStatus, actorId: string) {
    await this.prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    const updated = await this.prisma.business.update({
      where: { id: businessId },
      data: { status },
    });
    await this.audit.record(actorId, 'business.status.update', 'Business', businessId, { status });
    return updated;
  }

  async listAllBusinesses(query: ListBusinessesQueryDto) {
    const where: Prisma.BusinessWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { publicId: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
              { name: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
              { contactEmail: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
            ],
          }
        : {}),
    };

    // creditStatus is derived (not a column) so it can't be a Prisma filter —
    // when set, pull the full matching set, annotate, then filter + paginate
    // in app code. Without it, keep the cheap DB-side pagination.
    if (query.creditStatus) {
      const rows = await this.prisma.business.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { members: true, deliveries: true, invoices: true } } },
      });
      const annotated = (await this.annotateCredit(rows)).filter(
        (r) => r.creditStatus === query.creditStatus,
      );
      const skip = query.skip ?? 0;
      const take = query.take ?? 50;
      return toPaginated(annotated.slice(skip, skip + take), annotated.length, query);
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.business.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.take ?? 50,
        skip: query.skip ?? 0,
        include: { _count: { select: { members: true, deliveries: true, invoices: true } } },
      }),
      this.prisma.business.count({ where }),
    ]);

    return toPaginated(await this.annotateCredit(rows), total, query);
  }

  async exportBusinesses(
    query: ExportBusinessesQueryDto,
    actorId: string,
  ): Promise<ExportDocument> {
    const [page, generatedBy] = await Promise.all([
      this.listAllBusinesses({ ...query, take: EXPORT_MAX_ROWS, skip: 0 }),
      resolveActorName(this.prisma, actorId),
    ]);
    const rows = page.data;
    const n = (fn: (r: (typeof rows)[number]) => boolean) => rows.filter(fn).length;
    const sum = (fn: (r: (typeof rows)[number]) => Prisma.Decimal) =>
      rows.reduce((acc, r) => acc + fn(r).toNumber(), 0);

    return {
      title: 'Business Accounts Report',
      subtitle: 'Business accounts with credit limits, outstanding balances and usage',
      generatedBy,
      filters: describeFilters({
        Search: query.search,
        'Account status': query.status,
        'Credit status': query.creditStatus,
      }),
      summary: [
        {
          label: 'Total businesses',
          value: page.total,
          format: 'integer',
          note: 'Businesses matching the filters.',
        },
        {
          label: 'Active',
          value: n((r) => r.status === BusinessStatus.ACTIVE),
          format: 'integer',
          tone: 'good',
          note: 'Account status ACTIVE.',
        },
        {
          label: 'Suspended',
          value: n((r) => r.status === BusinessStatus.SUSPENDED),
          format: 'integer',
          tone: 'bad',
          note: 'Account status SUSPENDED.',
        },
        {
          label: 'Overdue',
          value: n((r) => r.creditStatus === 'OVERDUE'),
          format: 'integer',
          tone: 'bad',
          note: 'At least one invoice is past due.',
        },
        {
          label: 'On credit',
          value: n((r) => r.creditStatus === 'ON_CREDIT'),
          format: 'integer',
          tone: 'warn',
          note: 'Carrying an outstanding balance, nothing overdue.',
        },
        {
          label: 'Credit extended',
          value: sum((r) => r.creditLimit),
          format: 'currency',
          tone: 'info',
          note: 'Sum of credit limits.',
        },
        {
          label: 'Outstanding balance',
          value: sum((r) => r.outstanding),
          format: 'currency',
          tone: 'warn',
          note: 'Sum of what businesses currently owe on credit.',
        },
      ],
      sections: [
        {
          name: 'Businesses',
          description: 'One row per business account, newest first.',
          truncatedFrom: page.total > rows.length ? page.total : undefined,
          columns: [
            { key: 'name', header: 'Business', width: 28 },
            { key: 'registrationNumber', header: 'Reg. no.', width: 16 },
            { key: 'contactEmail', header: 'Contact email', width: 30 },
            { key: 'contactPhone', header: 'Contact phone', width: 16 },
            { key: 'status', header: 'Status', format: 'status' },
            { key: 'creditStatus', header: 'Credit status', format: 'status' },
            { key: 'creditLimit', header: 'Credit limit', format: 'currency', total: true },
            { key: 'outstanding', header: 'Outstanding', format: 'currency', total: true },
            { key: 'members', header: 'Team members', format: 'integer' },
            { key: 'deliveries', header: 'Deliveries', format: 'integer', total: true },
            { key: 'invoices', header: 'Invoices', format: 'integer', total: true },
            { key: 'createdAt', header: 'Created', format: 'date' },
          ],
          rows: rows.map((r) => ({
            ...r,
            members: r._count.members,
            deliveries: r._count.deliveries,
            invoices: r._count.invoices,
          })),
        },
      ],
    };
  }

  // Adds `outstanding` (BUSINESS_CREDIT_PAYABLE balance) and a derived
  // `creditStatus` to each business row.
  private async annotateCredit<T extends { id: string }>(rows: T[]) {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) {
      return rows.map((r) => ({
        ...r,
        outstanding: new Prisma.Decimal(0),
        creditStatus: 'NO_CREDIT' as CreditStatus,
      }));
    }

    const [payables, overdueGroups] = await Promise.all([
      this.prisma.account.findMany({
        where: { type: AccountType.BUSINESS_CREDIT_PAYABLE, ownerId: { in: ids } },
        select: { ownerId: true, balance: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['businessId'],
        where: { businessId: { in: ids }, status: InvoiceStatus.OVERDUE },
        _count: true,
      }),
    ]);
    const outstandingById = new Map(payables.map((p) => [p.ownerId, p.balance]));
    const overdueIds = new Set(overdueGroups.map((g) => g.businessId));

    return rows.map((r) => {
      const outstanding = outstandingById.get(r.id) ?? new Prisma.Decimal(0);
      const creditStatus: CreditStatus = overdueIds.has(r.id)
        ? 'OVERDUE'
        : outstanding.greaterThan(0)
          ? 'ON_CREDIT'
          : 'NO_CREDIT';
      return { ...r, outstanding, creditStatus };
    });
  }

  // Metric cards for the Business Management screen. Business has no status
  // column, so "active" = has at least one team member.
  async businessStats() {
    const [totalAccounts, activeAccounts, onCredit, outstanding] = await Promise.all([
      this.prisma.business.count(),
      this.prisma.business.count({ where: { members: { some: {} } } }),
      this.prisma.business.count({ where: { creditLimit: { gt: 0 } } }),
      this.prisma.account.aggregate({
        where: { type: AccountType.BUSINESS_CREDIT_PAYABLE },
        _sum: { balance: true },
      }),
    ]);

    return {
      totalAccounts,
      activeAccounts,
      onCredit,
      totalOutstanding: outstanding._sum.balance ?? new Prisma.Decimal(0),
    };
  }

  async getBusinessDetail(id: string) {
    const business = await this.prisma.business.findUnique({
      where: { id },
      include: { _count: { select: { members: true, deliveries: true } } },
    });
    if (!business) {
      throw new NotFoundException('Business not found');
    }

    const [invoiceSummary, payable, recentDeliveries] = await Promise.all([
      this.prisma.invoice.groupBy({
        by: ['status'],
        where: { businessId: id },
        _count: true,
        _sum: { amount: true },
      }),
      this.wallet.getOrCreateUserAccount(id, AccountType.BUSINESS_CREDIT_PAYABLE),
      this.prisma.delivery.findMany({
        where: { businessId: id },
        orderBy: { requestedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          publicId: true,
          status: true,
          pickupAddress: true,
          receiverName: true,
          finalFare: true,
          requestedAt: true,
          completedAt: true,
        },
      }),
    ]);

    return {
      ...business,
      outstanding: payable.balance,
      invoices: invoiceSummary.map((i) => ({
        status: i.status,
        count: i._count,
        amount: i._sum.amount ?? new Prisma.Decimal(0),
      })),
      recentDeliveries,
    };
  }

  async assertWithinCreditLimit(businessId: string, additionalAmount: Prisma.Decimal) {
    const [business, payable] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({ where: { id: businessId } }),
      this.wallet.getOrCreateUserAccount(businessId, AccountType.BUSINESS_CREDIT_PAYABLE),
    ]);
    if (payable.balance.plus(additionalAmount).greaterThan(business.creditLimit)) {
      throw new ForbiddenException('This would exceed the business credit limit');
    }
  }

  async assertMember(userId: string, businessId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.businessId !== businessId) {
      throw new ForbiddenException('You are not a member of this business');
    }
    return user;
  }

  async assertAdmin(userId: string, businessId: string) {
    const user = await this.assertMember(userId, businessId);
    if (user.role !== UserRole.BUSINESS_ADMIN) {
      throw new ForbiddenException('Only a business admin can perform this action');
    }
    return user;
  }
}
