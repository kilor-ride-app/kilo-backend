import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

interface PaystackResponse<T> {
  status: boolean;
  message: string;
  data: T;
}

export interface InitializeTransactionResult {
  authorization_url: string;
  access_code: string;
  reference: string;
}

// Present on card payments. `authorization_code` is what lets us charge
// the card again later without the customer re-entering it.
export interface PaystackAuthorization {
  authorization_code: string;
  last4: string;
  exp_month: string;
  exp_year: string;
  card_type: string; // "visa ", "mastercard", "verve" (Paystack pads some)
  brand?: string;
  bank: string | null;
  channel: string; // "card", "bank_transfer", ...
  reusable: boolean;
  signature: string | null; // per-card fingerprint
}

export interface VerifyTransactionResult {
  status: string; // 'success' | 'failed' | 'abandoned' | 'pending' | 'ongoing' | ...
  reference: string;
  amount: number; // kobo
  currency: string;
  channel?: string;
  gateway_response?: string;
  metadata: Record<string, unknown> | null;
  customer: { email: string };
  authorization?: PaystackAuthorization;
}

export interface ChargeAuthorizationResult {
  status: string; // 'success' | 'failed' | 'send_otp' | ...
  reference: string;
  gateway_response?: string;
}

export interface BankTransferChargeResult {
  status: string; // 'pending_bank_transfer'
  reference: string;
  display_text?: string;
  account_name: string;
  account_number: string;
  bank: { name: string; slug?: string };
  account_expires_at: string;
}

export interface ResolveAccountResult {
  account_number: string;
  account_name: string;
}

export interface TransferRecipientResult {
  recipient_code: string;
}

export interface TransferResult {
  transfer_code: string;
  reference: string;
  status: string;
}

@Injectable()
export class PaystackService {
  private readonly secretKey?: string;

  constructor(private readonly config: ConfigService) {
    this.secretKey = this.config.get<string>('PAYSTACK_SECRET_KEY') || undefined;
  }

  async initializeTransaction(params: {
    email: string;
    amountKobo: number;
    reference: string;
    metadata?: Record<string, unknown>;
    channels?: string[];
  }): Promise<InitializeTransactionResult> {
    return this.request('POST', '/transaction/initialize', {
      email: params.email,
      amount: params.amountKobo,
      reference: params.reference,
      metadata: params.metadata,
      ...(params.channels ? { channels: params.channels } : {}),
    });
  }

  // Charges a card saved from an earlier payment. Usually resolves
  // synchronously; charge.success still arrives via webhook either way.
  async chargeAuthorization(params: {
    email: string;
    amountKobo: number;
    authorizationCode: string;
    reference: string;
    metadata?: Record<string, unknown>;
  }): Promise<ChargeAuthorizationResult> {
    return this.request('POST', '/transaction/charge_authorization', {
      email: params.email,
      amount: params.amountKobo,
      authorization_code: params.authorizationCode,
      reference: params.reference,
      metadata: params.metadata,
    });
  }

  // "Pay with Transfer": Paystack issues a temporary account number for
  // exactly this payment; charge.success fires once the money lands.
  async chargeBankTransfer(params: {
    email: string;
    amountKobo: number;
    reference: string;
    expiresAt: Date;
    metadata?: Record<string, unknown>;
  }): Promise<BankTransferChargeResult> {
    return this.request('POST', '/charge', {
      email: params.email,
      amount: params.amountKobo,
      reference: params.reference,
      metadata: params.metadata,
      bank_transfer: { account_expires_at: params.expiresAt.toISOString() },
    });
  }

  async verifyTransaction(reference: string): Promise<VerifyTransactionResult> {
    return this.request('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  }

  async resolveAccountNumber(
    accountNumber: string,
    bankCode: string,
  ): Promise<ResolveAccountResult> {
    return this.request(
      'GET',
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    );
  }

  async createTransferRecipient(params: {
    name: string;
    accountNumber: string;
    bankCode: string;
  }): Promise<TransferRecipientResult> {
    return this.request('POST', '/transferrecipient', {
      type: 'nuban',
      name: params.name,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: 'NGN',
    });
  }

  async initiateTransfer(params: {
    amountKobo: number;
    recipientCode: string;
    reference: string;
    reason?: string;
  }): Promise<TransferResult> {
    return this.request('POST', '/transfer', {
      source: 'balance',
      amount: params.amountKobo,
      recipient: params.recipientCode,
      reference: params.reference,
      reason: params.reason,
    });
  }

  // Constant-time comparison, and a length check first — timingSafeEqual
  // throws (rather than returning false) on mismatched buffer lengths.
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!this.secretKey || !signature) {
      return false;
    }
    const expected = Buffer.from(
      createHmac('sha512', this.secretKey).update(rawBody).digest('hex'),
    );
    const given = Buffer.from(signature);
    if (expected.length !== given.length) {
      return false;
    }
    return timingSafeEqual(expected, given);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.secretKey) {
      throw new ServiceUnavailableException('Paystack is not configured');
    }

    const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = (await response.json()) as PaystackResponse<T>;
    if (!response.ok || json.status === false) {
      throw new BadGatewayException(
        `Paystack request failed: ${json.message ?? response.statusText}`,
      );
    }
    return json.data;
  }
}
