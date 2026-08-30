import { Injectable, NotFoundException } from '@nestjs/common';
import { KycDocumentType, KycStatus, KycVerificationType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { R2Service } from '../integrations/r2/r2.service';
import { SmileIdentityService } from '../integrations/smile-identity/smile-identity.service';

const REQUIRED_DOCUMENT_TYPES: KycDocumentType[] = [
  KycDocumentType.LICENSE,
  KycDocumentType.VEHICLE_REGISTRATION,
  KycDocumentType.ROADWORTHINESS,
  KycDocumentType.HACKNEY_PERMIT,
];

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    private readonly smileIdentity: SmileIdentityService,
    private readonly audit: AuditService,
  ) {}

  async uploadDocument(driverId: string, type: KycDocumentType, file: Express.Multer.File) {
    const fileKey = `kyc/${driverId}/${type}/${randomUUID()}-${file.originalname}`;
    await this.r2.uploadObject(fileKey, file.buffer, file.mimetype);

    return this.prisma.kycDocument.create({
      data: { driverId, type, fileKey, status: KycStatus.PENDING },
    });
  }

  async submitFacialVerification(driverId: string, selfieImageBase64: string) {
    const result = await this.smileIdentity.submitFacialVerification(driverId, selfieImageBase64);
    return this.prisma.kycVerification.create({
      data: {
        driverId,
        type: KycVerificationType.FACIAL,
        providerReference: result.jobId,
        status: KycStatus.PENDING,
        rawResult: result.raw as object,
      },
    });
  }

  async submitGovernmentId(driverId: string, idType: string, idNumber: string) {
    const result = await this.smileIdentity.submitGovernmentIdVerification(
      driverId,
      idType,
      idNumber,
    );
    return this.prisma.kycVerification.create({
      data: {
        driverId,
        type: KycVerificationType.GOVERNMENT_ID,
        providerReference: result.jobId,
        status: KycStatus.PENDING,
        rawResult: result.raw as object,
      },
    });
  }

  async getStatus(driverId: string) {
    const [documents, verifications] = await Promise.all([
      this.prisma.kycDocument.findMany({ where: { driverId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.kycVerification.findMany({ where: { driverId }, orderBy: { createdAt: 'desc' } }),
    ]);

    // Latest submission per type is what counts — a resubmission after a
    // rejection supersedes the rejected one rather than being blocked by it.
    const latestDocByType = new Map<KycDocumentType, (typeof documents)[number]>();
    for (const doc of documents) {
      if (!latestDocByType.has(doc.type)) {
        latestDocByType.set(doc.type, doc);
      }
    }
    const latestVerificationByType = new Map<KycVerificationType, (typeof verifications)[number]>();
    for (const v of verifications) {
      if (!latestVerificationByType.has(v.type)) {
        latestVerificationByType.set(v.type, v);
      }
    }

    const requiredStatuses = [
      ...REQUIRED_DOCUMENT_TYPES.map((type) => latestDocByType.get(type)?.status),
      latestVerificationByType.get(KycVerificationType.FACIAL)?.status,
      latestVerificationByType.get(KycVerificationType.GOVERNMENT_ID)?.status,
    ];

    let overall: KycStatus;
    if (requiredStatuses.some((s) => s === KycStatus.REJECTED)) {
      overall = KycStatus.REJECTED;
    } else if (requiredStatuses.every((s) => s === KycStatus.APPROVED)) {
      overall = KycStatus.APPROVED;
    } else {
      overall = KycStatus.PENDING;
    }

    return {
      overall,
      documents: [...latestDocByType.values()],
      verifications: [...latestVerificationByType.values()],
    };
  }

  // Bulk operations, matching the endpoint shape (no per-document ID in the
  // path) — approves/rejects every currently-PENDING document for this
  // driver in one action. Automated verifications (facial/government-id)
  // aren't touched here — their status comes from the provider, not admin review.
  async approve(driverId: string, reviewerId: string) {
    const result = await this.prisma.kycDocument.updateMany({
      where: { driverId, status: KycStatus.PENDING },
      data: { status: KycStatus.APPROVED, reviewedById: reviewerId, reviewedAt: new Date() },
    });
    await this.audit.record(reviewerId, 'kyc.approve', 'User', driverId, {
      documentsApproved: result.count,
    });
    return { approved: result.count };
  }

  async reject(driverId: string, reviewerId: string, reason: string) {
    const result = await this.prisma.kycDocument.updateMany({
      where: { driverId, status: KycStatus.PENDING },
      data: {
        status: KycStatus.REJECTED,
        rejectionReason: reason,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
      },
    });
    await this.audit.record(reviewerId, 'kyc.reject', 'User', driverId, {
      documentsRejected: result.count,
      reason,
    });
    return { rejected: result.count };
  }

  async listPending(take = 50, skip = 0) {
    const driverIds = await this.prisma.kycDocument.findMany({
      where: { status: KycStatus.PENDING },
      distinct: ['driverId'],
      select: { driverId: true },
      take,
      skip,
    });
    if (driverIds.length === 0) {
      return [];
    }

    const drivers = await this.prisma.user.findMany({
      where: { id: { in: driverIds.map((d) => d.driverId) } },
      select: { id: true, firstName: true, lastName: true, phone: true, email: true },
    });
    return drivers;
  }

  async getSignedDocumentUrl(documentId: string) {
    const document = await this.prisma.kycDocument.findUnique({ where: { id: documentId } });
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    return { url: await this.r2.getSignedReadUrl(document.fileKey) };
  }
}
