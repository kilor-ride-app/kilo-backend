import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { render } from '@react-email/render';
import { BusinessTeamInviteEmail } from './templates/business-team-invite-email';
import { GuarantorInviteEmail } from './templates/guarantor-invite-email';
import { PasswordResetLinkEmail } from './templates/password-reset-link-email';
import { StaffInviteEmail } from './templates/staff-invite-email';
import { VerificationCodeEmail } from './templates/verification-code-email';

const RESEND_SEND_URL = 'https://api.resend.com/emails';

// One sender identity per email purpose, all on the verified mail.kilo.ng
// domain — so a security-sensitive email (password reset) doesn't arrive
// looking identical to a routine invite in the inbox list. EMAIL_FROM, when
// set, overrides all of these at once (useful for local/dev testing against
// a single sandbox address).
const FROM = {
  verification: 'Kilo <hello@mail.kilo.ng>',
  passwordReset: 'Kilo Security <security@mail.kilo.ng>',
  invite: 'Kilo Team <invites@mail.kilo.ng>',
  guarantor: 'Kilo <noreply@mail.kilo.ng>',
  reports: 'Kilo Reports <reports@mail.kilo.ng>',
} as const;

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey?: string;
  private readonly fromOverride?: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('RESEND_API_KEY') || undefined;
    this.fromOverride = this.config.get<string>('EMAIL_FROM') || undefined;
  }

  async sendVerificationCode(to: string, code: string, expiresInMinutes = 10): Promise<void> {
    const html = await render(
      <VerificationCodeEmail code={code} expiresInMinutes={expiresInMinutes} />,
    );
    await this.dispatch(FROM.verification, to, 'Verify your Kilo email', html);
  }

  async sendPasswordResetLink(to: string, resetUrl: string, expiresInMinutes = 30): Promise<void> {
    const html = await render(
      <PasswordResetLinkEmail resetUrl={resetUrl} expiresInMinutes={expiresInMinutes} />,
    );
    await this.dispatch(FROM.passwordReset, to, 'Reset your Kilo password', html);
  }

  async sendStaffInvite(
    to: string,
    roles: string[],
    acceptUrl: string,
    expiresInDays = 7,
  ): Promise<void> {
    const html = await render(
      <StaffInviteEmail roles={roles} acceptUrl={acceptUrl} expiresInDays={expiresInDays} />,
    );
    await this.dispatch(FROM.invite, to, "You've been invited to join Kilo", html);
  }

  async sendBusinessTeamInvite(
    to: string,
    businessName: string,
    acceptUrl: string,
    expiresInDays = 7,
  ): Promise<void> {
    const html = await render(
      <BusinessTeamInviteEmail
        businessName={businessName}
        acceptUrl={acceptUrl}
        expiresInDays={expiresInDays}
      />,
    );
    await this.dispatch(FROM.invite, to, `You've been invited to join ${businessName}`, html);
  }

  async sendGuarantorInvite(
    to: string,
    driverName: string,
    submitUrl: string,
    expiresInDays = 14,
  ): Promise<void> {
    const html = await render(
      <GuarantorInviteEmail
        driverName={driverName}
        submitUrl={submitUrl}
        expiresInDays={expiresInDays}
      />,
    );
    await this.dispatch(FROM.guarantor, to, `${driverName} has listed you as a guarantor`, html);
  }

  // Used by ReportsProcessor to deliver a scheduled report — attachment
  // content is base64-encoded per Resend's send API (this codebase calls
  // the raw HTTP API, not their SDK, so the encoding has to be done here).
  async sendWithAttachment(
    to: string,
    subject: string,
    html: string,
    attachment: { filename: string; content: Buffer },
  ): Promise<void> {
    await this.dispatch(FROM.reports, to, subject, html, [
      { filename: attachment.filename, content: attachment.content.toString('base64') },
    ]);
  }

  private async dispatch(
    from: string,
    to: string,
    subject: string,
    html: string,
    attachments?: { filename: string; content: string }[],
  ): Promise<void> {
    if (!this.apiKey) {
      // No email provider configured — safe fallback for local dev so
      // invite/verification flows are still testable without a Resend account.
      this.logger.warn(`[DEV — no RESEND_API_KEY set] Email to ${to} — ${subject}`);
      return;
    }

    const response = await fetch(RESEND_SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        from: this.fromOverride ?? from,
        to,
        subject,
        html,
        ...(attachments ? { attachments } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Resend email send failed (${response.status}): ${body}`);
      throw new Error('Failed to send email');
    }
  }
}
