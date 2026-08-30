import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { PaystackService } from '../integrations/paystack/paystack.service';
import { PaymentsService } from './payments.service';

interface PaystackWebhookPayload {
  event: string;
  data: { reference: string };
}

// Real Paystack has one global webhook URL per account (not one per
// transaction) — deliberately deviates from the plan.md endpoint table's
// `/wallet/withdraw/{id}/webhook`, which isn't how the gateway actually
// works. Every event type lands here and gets routed by `event`.
@ApiTags('wallet')
@SkipThrottle()
@Controller('wallet/webhooks')
export class WalletWebhooksController {
  constructor(
    private readonly paystack: PaystackService,
    private readonly payments: PaymentsService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('paystack')
  async handlePaystackWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature?: string,
  ) {
    if (!req.rawBody || !this.paystack.verifyWebhookSignature(req.rawBody, signature)) {
      throw new UnauthorizedException('Invalid Paystack signature');
    }

    const event = req.body as PaystackWebhookPayload;
    switch (event.event) {
      case 'charge.success':
        await this.payments.processTopUpWebhookEvent(event.data.reference);
        break;
      case 'transfer.success':
        await this.payments.processTransferWebhookEvent(event.data.reference, true);
        break;
      case 'transfer.failed':
      case 'transfer.reversed':
        await this.payments.processTransferWebhookEvent(event.data.reference, false);
        break;
      default:
        break; // other event types aren't handled yet
    }

    // Always 200 regardless of what happened above — Paystack retries on
    // anything else, and our processing is idempotent by reference anyway.
    return { received: true };
  }
}
