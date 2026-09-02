import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { render } from '@react-email/render';
import { BusinessTeamInviteEmail } from './templates/business-team-invite-email';
import { GuarantorInviteEmail } from './templates/guarantor-invite-email';
import { PasswordResetCodeEmail } from './templates/password-reset-code-email';
import { StaffInviteEmail } from './templates/staff-invite-email';
import { VerificationCodeEmail } from './templates/verification-code-email';

const RESEND_SEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Kilo <onboarding@resend.dev>'; // resend.dev works with no domain setup — swap once a real sending domain is verified in Resend

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey?: string;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('RESEND_API_KEY') || undefined;
    this.from = this.config.get<string>('EMAIL_FROM') || DEFAULT_FROM;
  }

  async sendVerificationCode(to: string, code: string, expiresInMinutes = 10): Promise<void> {
    const html = await render(
      <VerificationCodeEmail code={code} expiresInMinutes={expiresInMinutes} />,
    );
    await this.dispatch(to, 'Verify your Kilo email', html);
  }

  async sendPasswordResetCode(to: string, code: string, expiresInMinutes = 10): Promise<void> {
    const html = await render(
      <PasswordResetCodeEmail code={code} expiresInMinutes={expiresInMinutes} />,
    );
    await this.dispatch(to, 'Reset your Kilo password', html);
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
    await this.dispatch(to, "You've been invited to join Kilo", html);
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
    await this.dispatch(to, `You've been invited to join ${businessName}`, html);
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
    await this.dispatch(to, `${driverName} has listed you as a guarantor`, html);
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
    await this.dispatch(to, subject, html, [
      { filename: attachment.filename, content: attachment.content.toString('base64') },
    ]);
  }

  private async dispatch(
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
        from: this.from,
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
