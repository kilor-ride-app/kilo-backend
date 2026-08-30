import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, cert, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

export interface PushSendResult {
  successTokens: string[];
  invalidTokens: string[]; // no longer registered — caller should delete these DeviceToken rows
}

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);
  private readonly app?: App;

  constructor(config: ConfigService) {
    const json = config.get<string>('FCM_SERVICE_ACCOUNT_JSON');
    if (!json) {
      return;
    }
    try {
      const credentials = JSON.parse(json);
      this.app = initializeApp({ credential: cert(credentials) }, 'kilo-fcm');
    } catch (err) {
      this.logger.error(`Failed to parse FCM_SERVICE_ACCOUNT_JSON: ${err}`);
    }
  }

  get isConfigured(): boolean {
    return !!this.app;
  }

  async sendToTokens(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<PushSendResult> {
    if (!this.app || tokens.length === 0) {
      // No fallback log needed here — NotificationsService already records
      // the in-app Notification row regardless of push delivery; this is
      // purely the push-channel best-effort layer on top of that.
      if (tokens.length > 0) {
        this.logger.warn(
          `[DEV — no FCM_SERVICE_ACCOUNT_JSON set] Push to ${tokens.length} device(s): ${title}`,
        );
      }
      return { successTokens: [], invalidTokens: [] };
    }

    const response = await getMessaging(this.app).sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
    });

    const successTokens: string[] = [];
    const invalidTokens: string[] = [];
    response.responses.forEach((result, i: number) => {
      if (result.success) {
        successTokens.push(tokens[i]);
      } else if (
        result.error?.code === 'messaging/registration-token-not-registered' ||
        result.error?.code === 'messaging/invalid-registration-token'
      ) {
        invalidTokens.push(tokens[i]);
      }
    });

    return { successTokens, invalidTokens };
  }
}
