import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TERMII_SEND_URL = 'https://api.ng.termii.com/api/sms/send';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly apiKey?: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('TERMII_API_KEY') || undefined;
  }

  async sendOtp(phone: string, code: string): Promise<void> {
    await this.sendMessage(
      phone,
      `Your Kilo verification code is ${code}. It expires in 10 minutes.`,
    );
  }

  // Generic send, for anything that isn't the auth-OTP flow above — e.g.
  // LogisticsService's receiver tracking link + delivery OTP.
  async sendMessage(phone: string, message: string): Promise<void> {
    if (!this.apiKey) {
      // No SMS provider configured — safe fallback for local dev so these
      // flows are still testable end-to-end without a Termii account.
      this.logger.warn(`[DEV — no TERMII_API_KEY set] SMS to ${phone}: ${message}`);
      return;
    }

    const response = await fetch(TERMII_SEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        to: phone,
        sms: message,
        type: 'plain',
        channel: 'generic',
        from: 'N-Alert', // the only sender ID active on the Termii account — see PROGRESS.md
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Termii SMS send failed (${response.status}): ${body}`);
      throw new Error('Failed to send SMS');
    }
  }
}
