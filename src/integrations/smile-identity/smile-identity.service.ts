import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

// UNVERIFIED AGAINST A LIVE SANDBOX — unlike PaystackService (a simple,
// well-documented REST API I'm confident matches reality), Smile
// Identity's actual current job-submission contract (field names, exact
// signature scheme, sync vs. async job result delivery) needs to be
// checked against their real docs/sandbox before this goes live. The
// shape below (HMAC-signed job submission, partner_id/api_key auth) matches
// their commonly-documented pattern, but treat every field name here as a
// best-effort placeholder, not a verified contract.
const SMILE_IDENTITY_BASE_URL = 'https://testapi.smileidentity.com/v1';

export interface KycVerificationResult {
  jobId: string;
  status: 'pending' | 'verified' | 'failed';
  raw: unknown;
}

@Injectable()
export class SmileIdentityService {
  private readonly partnerId?: string;
  private readonly apiKey?: string;

  constructor(config: ConfigService) {
    this.partnerId = config.get<string>('SMILE_IDENTITY_PARTNER_ID') || undefined;
    this.apiKey = config.get<string>('SMILE_IDENTITY_API_KEY') || undefined;
  }

  get isConfigured(): boolean {
    return !!this.partnerId && !!this.apiKey;
  }

  async submitFacialVerification(
    driverId: string,
    selfieImageBase64: string,
  ): Promise<KycVerificationResult> {
    return this.submitJob('facial', driverId, { selfie_image: selfieImageBase64 });
  }

  async submitGovernmentIdVerification(
    driverId: string,
    idType: string,
    idNumber: string,
  ): Promise<KycVerificationResult> {
    return this.submitJob('government_id', driverId, { id_type: idType, id_number: idNumber });
  }

  private async submitJob(
    jobType: string,
    driverId: string,
    payload: Record<string, unknown>,
  ): Promise<KycVerificationResult> {
    if (!this.partnerId || !this.apiKey) {
      throw new ServiceUnavailableException('Identity verification is not configured');
    }

    const timestamp = new Date().toISOString();
    const signature = createHmac('sha256', this.apiKey)
      .update(`${this.partnerId}${timestamp}`)
      .digest('base64');

    const response = await fetch(`${SMILE_IDENTITY_BASE_URL}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partner_id: this.partnerId,
        timestamp,
        signature,
        job_type: jobType,
        partner_params: { user_id: driverId, job_id: `${driverId}:${jobType}:${Date.now()}` },
        ...payload,
      }),
    });

    const json = await response.json();
    if (!response.ok) {
      throw new BadGatewayException(
        `Smile Identity request failed: ${json.error ?? response.statusText}`,
      );
    }

    return {
      jobId: json.job_id ?? json.SmileJobID ?? '',
      status: 'pending',
      raw: json,
    };
  }
}
