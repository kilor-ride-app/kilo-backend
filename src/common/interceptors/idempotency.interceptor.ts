import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { hashToken } from '../utils/token.util';

const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000;

// Every payment-initiating endpoint requires an Idempotency-Key header
// (plan.md Section 10) — a flaky client retrying the same top-up/withdraw
// request must produce one charge, not several. This handles the common
// "client retried sequentially after a timeout" case; the deeper safety net
// for genuinely concurrent duplicate requests is the ledger's own
// reference-uniqueness + balance-guard invariants in WalletService, which
// hold regardless of what happens at this layer — that's why plan.md treats
// idempotency keys, webhook idempotency, and wallet concurrency control as
// three separate layers rather than relying on any single one.
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest();
    const key = request.headers['idempotency-key'];
    if (!key || typeof key !== 'string') {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const requestHash = hashToken(JSON.stringify(request.body ?? {}));
    const existing = await this.prisma.idempotencyKey.findUnique({ where: { key } });

    if (existing && existing.expiresAt > new Date()) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException(
          'Idempotency-Key was already used with a different request body',
        );
      }
      return of(existing.responseBody);
    }

    return next.handle().pipe(
      tap((responseBody: unknown) => {
        this.prisma.idempotencyKey
          .upsert({
            where: { key },
            update: {
              requestHash,
              responseBody: responseBody as object,
              expiresAt: new Date(Date.now() + IDEMPOTENCY_KEY_TTL_MS),
            },
            create: {
              key,
              requestHash,
              responseBody: responseBody as object,
              expiresAt: new Date(Date.now() + IDEMPOTENCY_KEY_TTL_MS),
            },
          })
          .catch(() => {
            // Best-effort — a race on the write shouldn't fail a response
            // that already succeeded; worst case, a concurrent retry
            // reprocesses once, which the ledger's own guards still protect.
          });
      }),
    );
  }
}
