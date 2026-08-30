import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../integrations/email/email.service';
import { OtpService } from './otp.service';
import { OtpPurpose } from './types/otp-purpose.enum';

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly otp: OtpService,
  ) {}

  // Shared by registration (verifying the email given at signup) and the
  // profile email-change flow below — both just need "send a code to this
  // address for this user."
  async sendForAddress(userId: string, address: string) {
    const code = await this.otp.generateAndStore(userId, OtpPurpose.EMAIL_VERIFICATION);
    await this.email.sendVerificationCode(address, code);
  }

  // Sets a pending change rather than touching `email` directly — protects
  // the account's already-verified address until the new one is confirmed,
  // and (since pendingEmail isn't unique) never blocks anyone else's claim
  // to the same address in the meantime.
  async requestChange(userId: string, newEmail: string) {
    const taken = await this.prisma.user.findUnique({ where: { email: newEmail } });
    if (taken && taken.id !== userId) {
      throw new ConflictException('An account with this email already exists');
    }

    await this.prisma.user.update({ where: { id: userId }, data: { pendingEmail: newEmail } });
    await this.sendForAddress(userId, newEmail);
    return { message: 'Verification code sent' };
  }

  async confirm(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const targetEmail = user.pendingEmail ?? user.email;
    if (!targetEmail) {
      throw new ConflictException('No email to verify — set one first');
    }

    await this.otp.verify(userId, OtpPurpose.EMAIL_VERIFICATION, code);

    if (targetEmail !== user.email) {
      const taken = await this.prisma.user.findUnique({ where: { email: targetEmail } });
      if (taken && taken.id !== userId) {
        throw new ConflictException('This email was claimed by another account in the meantime');
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { email: targetEmail, emailVerifiedAt: new Date(), pendingEmail: null },
    });
    return { message: 'Email verified' };
  }
}
