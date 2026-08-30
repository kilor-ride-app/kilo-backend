import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GuarantorStatus } from '@prisma/client';
import { generateSecureToken, hashToken } from '../common/utils/token.util';
import { EmailService } from '../integrations/email/email.service';
import { R2Service } from '../integrations/r2/r2.service';
import { SmsService } from '../integrations/sms/sms.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// Fields safe to hand back to the driver/admin — never the raw tokenHash.
const GUARANTOR_SELECT = {
  id: true,
  driverId: true,
  fullName: true,
  email: true,
  phone: true,
  relationship: true,
  address: true,
  occupation: true,
  idType: true,
  idNumber: true,
  status: true,
  expiresAt: true,
  submittedAt: true,
  reviewedById: true,
  reviewedAt: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class GuarantorService {
  private readonly logger = new Logger(GuarantorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
    private readonly r2: R2Service,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // A pending (INVITED, not yet submitted) invite is rotated with a fresh
  // token + expiry — covers "resend the link" without a separate endpoint.
  // A SUBMITTED or VERIFIED guarantor blocks a new invite outright; a
  // REJECTED one is left alone and a brand new row is created, preserving
  // the rejected attempt's history for admin review.
  async invite(driverId: string, dto: { fullName: string; email?: string; phone?: string }) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('At least one of email or phone is required');
    }

    const existing = await this.prisma.guarantor.findFirst({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
    });
    if (existing?.status === GuarantorStatus.SUBMITTED) {
      throw new ConflictException('A guarantor submission is already awaiting review');
    }
    if (existing?.status === GuarantorStatus.VERIFIED) {
      throw new ConflictException('Your guarantor has already been verified');
    }

    const rawToken = generateSecureToken();
    const data = {
      driverId,
      fullName: dto.fullName,
      email: dto.email,
      phone: dto.phone,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      status: GuarantorStatus.INVITED,
    };

    const guarantor =
      existing?.status === GuarantorStatus.INVITED
        ? await this.prisma.guarantor.update({
            where: { id: existing.id },
            data,
            select: GUARANTOR_SELECT,
          })
        : await this.prisma.guarantor.create({ data, select: GUARANTOR_SELECT });

    const driver = await this.prisma.user.findUniqueOrThrow({ where: { id: driverId } });
    const driverName = `${driver.firstName} ${driver.lastName}`;
    const submitUrl = `${this.config.get<string>('GUARANTOR_APP_URL') ?? 'http://localhost:5176'}/guarantor/${rawToken}`;

    if (dto.email) {
      this.email
        .sendGuarantorInvite(
          dto.email,
          driverName,
          submitUrl,
          INVITE_TTL_MS / (24 * 60 * 60 * 1000),
        )
        .catch((err) => this.logger.warn(`Failed to send guarantor invite email: ${err}`));
    }
    if (dto.phone) {
      this.sms
        .sendMessage(
          dto.phone,
          `${driverName} has listed you as a guarantor on Kilo. Complete the form: ${submitUrl}`,
        )
        .catch((err) => this.logger.warn(`Failed to send guarantor invite SMS: ${err}`));
    }

    return guarantor;
  }

  // Driver-facing tracking — always the most recent guarantor row.
  async getStatus(driverId: string) {
    const guarantor = await this.prisma.guarantor.findFirst({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      select: GUARANTOR_SELECT,
    });
    if (!guarantor) {
      return { status: 'NOT_INVITED' as const };
    }
    return guarantor;
  }

  // Public — no auth. Tells the guarantor whose vouching form this is and
  // whether it's still open, without exposing anything about the driver
  // beyond their name.
  async getPublicContext(token: string) {
    const guarantor = await this.findByTokenOrThrow(token);
    const driver = await this.prisma.user.findUniqueOrThrow({ where: { id: guarantor.driverId } });
    return {
      driverName: `${driver.firstName} ${driver.lastName}`,
      status: guarantor.status,
      canSubmit: guarantor.status === GuarantorStatus.INVITED && guarantor.expiresAt > new Date(),
    };
  }

  async submit(
    token: string,
    dto: {
      fullName: string;
      relationship: string;
      address: string;
      occupation: string;
      idType: string;
      idNumber: string;
    },
    files: { idDocument?: Express.Multer.File; proofOfAddress?: Express.Multer.File },
  ) {
    const guarantor = await this.findByTokenOrThrow(token);
    if (guarantor.status !== GuarantorStatus.INVITED) {
      throw new ConflictException('This guarantor form has already been submitted');
    }
    if (guarantor.expiresAt < new Date()) {
      throw new BadRequestException('This link has expired — ask the driver to resend the invite');
    }
    if (!files.idDocument) {
      throw new BadRequestException('An identification document is required');
    }

    const idDocumentKey = `guarantor/${guarantor.id}/id/${Date.now()}-${files.idDocument.originalname}`;
    await this.r2.uploadObject(idDocumentKey, files.idDocument.buffer, files.idDocument.mimetype);

    let proofOfAddressKey: string | undefined;
    if (files.proofOfAddress) {
      proofOfAddressKey = `guarantor/${guarantor.id}/address/${Date.now()}-${files.proofOfAddress.originalname}`;
      await this.r2.uploadObject(
        proofOfAddressKey,
        files.proofOfAddress.buffer,
        files.proofOfAddress.mimetype,
      );
    }

    const updated = await this.prisma.guarantor.update({
      where: { id: guarantor.id },
      data: {
        ...dto,
        idDocumentKey,
        proofOfAddressKey,
        status: GuarantorStatus.SUBMITTED,
        submittedAt: new Date(),
      },
      select: GUARANTOR_SELECT,
    });

    await this.notifications.send(
      guarantor.driverId,
      'KYC',
      'Your guarantor submitted their details',
      'Their submission is now awaiting review.',
    );

    return updated;
  }

  async listPending(status?: GuarantorStatus, take = 50, skip = 0) {
    return this.prisma.guarantor.findMany({
      where: status ? { status } : { status: GuarantorStatus.SUBMITTED },
      orderBy: { createdAt: 'desc' },
      select: GUARANTOR_SELECT,
      take,
      skip,
    });
  }

  async approve(id: string, reviewerId: string) {
    const guarantor = await this.findOrThrow(id);
    if (guarantor.status !== GuarantorStatus.SUBMITTED) {
      throw new ConflictException('Only a submitted guarantor can be verified');
    }

    const updated = await this.prisma.guarantor.update({
      where: { id },
      data: { status: GuarantorStatus.VERIFIED, reviewedById: reviewerId, reviewedAt: new Date() },
      select: GUARANTOR_SELECT,
    });
    await this.audit.record(reviewerId, 'guarantor.approve', 'User', guarantor.driverId, {
      guarantorId: id,
    });
    await this.notifications.send(
      guarantor.driverId,
      'KYC',
      'Your guarantor has been verified',
      'Your guarantor verification is complete.',
    );
    return updated;
  }

  async reject(id: string, reviewerId: string, reason: string) {
    const guarantor = await this.findOrThrow(id);
    if (guarantor.status !== GuarantorStatus.SUBMITTED) {
      throw new ConflictException('Only a submitted guarantor can be rejected');
    }

    const updated = await this.prisma.guarantor.update({
      where: { id },
      data: {
        status: GuarantorStatus.REJECTED,
        rejectionReason: reason,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
      },
      select: GUARANTOR_SELECT,
    });
    await this.audit.record(reviewerId, 'guarantor.reject', 'User', guarantor.driverId, {
      guarantorId: id,
      reason,
    });
    await this.notifications.send(
      guarantor.driverId,
      'KYC',
      'Your guarantor submission was rejected',
      reason,
    );
    return updated;
  }

  async getSignedDocumentUrl(id: string, field: 'idDocument' | 'proofOfAddress') {
    const guarantor = await this.findOrThrow(id);
    const key = field === 'idDocument' ? guarantor.idDocumentKey : guarantor.proofOfAddressKey;
    if (!key) {
      throw new NotFoundException(`No ${field} on file for this guarantor`);
    }
    return { url: await this.r2.getSignedReadUrl(key) };
  }

  private async findByTokenOrThrow(token: string) {
    const guarantor = await this.prisma.guarantor.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!guarantor) {
      throw new NotFoundException('Invalid guarantor link');
    }
    return guarantor;
  }

  private async findOrThrow(id: string) {
    const guarantor = await this.prisma.guarantor.findUnique({ where: { id } });
    if (!guarantor) {
      throw new NotFoundException('Guarantor not found');
    }
    return guarantor;
  }
}
