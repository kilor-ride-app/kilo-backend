// Sentry must be initialized before any other module is imported — this
// file is imported first, on its own, at the very top of main.ts, so its
// auto-instrumentation can patch Node's http/express internals before
// anything else touches them (Sentry's own requirement, not a style choice).
//
// Deliberately no @sentry/profiling-node here — it ships no prebuilt native
// binary for every Node version/platform and hangs the process at boot
// trying to resolve one when it's missing (confirmed live on this machine's
// Node version). Error tracking (the actual goal) doesn't need it.
import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  });
}
