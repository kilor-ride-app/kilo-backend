# Kilo Backend

NestJS backend for the Kilo mobility, logistics, and energy platform.

Full architecture, endpoint list, and rationale: see [`kilo-backend-plan.md`](./kilo-backend-plan.md) in this repo.

Current build status, what's been done task-by-task, and the checklist of credentials still needed before launch: see [`PROGRESS.md`](./PROGRESS.md).

## Stack

- **NestJS** (TypeScript) — modular monolith, one module per domain (`src/<domain>`)
- **PostgreSQL + PostGIS** via **Prisma** — accessed through **PgBouncer** in transaction-pooling mode
- **Redis** — caching, BullMQ broker, Socket.io adapter, driver geo-index
- **BullMQ** — background jobs (notifications, reports, reconciliation)
- **Socket.io** (NestJS Gateways) — live dispatch offers, live tracking

## Local development

```bash
cp .env.example .env         # fill in third-party keys as you build each integration
docker compose up -d postgres redis pgbouncer
npm install
npm run prisma:migrate:dev
npm run seed                 # baseline permissions/roles + a bootstrap SUPER_ADMIN (see below)
npm run start:dev
```

### Seeding

```bash
npm run seed              # both of the below
npm run seed:permissions  # baseline Permission catalog + starter Roles (manager, finance, logistics, support)
npm run seed:superadmin   # bootstrap SUPER_ADMIN — every other staff account is created via an invite from this one
```

`seed:superadmin` is re-runnable and safe to call again to update the existing account (matches by phone). Override the defaults:

```bash
SUPERADMIN_PHONE=+234... SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... npm run seed:superadmin
```

The app also runs fully inside Docker via `docker compose up`, but running `postgres`/`redis`/`pgbouncer` in containers and the app locally with `start:dev` gives faster iteration (hot reload) during active development.

## Project structure

```
src/
  <domain>/            # one folder per business domain (accounts, wallet, rides, ...)
    <domain>.module.ts # currently a stub — controllers/services/DTOs added as each Task lands
  common/               # guards, decorators, interceptors, pipes, filters shared across domains
  integrations/         # third-party API clients (payment, sms, push, kyc-provider, maps, email)
  prisma/               # PrismaService + PrismaModule (global, injectable anywhere)
  app.module.ts
  main.ts
prisma/
  schema.prisma          # includes core identity models + the full wallet ledger schema
```

Each domain module is currently a stub (`@Module({})` with empty arrays) — see `kilo-backend-plan.md` Section 14 for the task-by-task build order. Fill in controllers/services/DTOs per task, not all at once.

## API documentation

Swagger/OpenAPI, generated from controller and DTO decorators — never hand-maintained, so it can't drift from the real API.

- Run the app, then open **`http://localhost:3000/docs`**
- Every DTO should follow the pattern in `src/accounts/dto/register-rider.dto.ts` — `class-validator` decorators for runtime validation and `@ApiProperty` for docs, on the same class, so they can't get out of sync with each other
- Protected controllers: add `@ApiBearerAuth('access-token')` at the controller level so Swagger UI shows the auth requirement and lets you paste a token in to test
- Set `ENABLE_SWAGGER=false` in production if the API surface shouldn't be publicly browsable — it's on by default in dev

## Conventions

- All endpoints versioned under `/api/v1` (set globally in `main.ts`)
- Every mutating endpoint uses a DTO validated via `class-validator` — no unvalidated request bodies
- Every payment-initiating endpoint requires an `Idempotency-Key` header (plan.md Section 10) — enforce via a shared interceptor once Task 5 lands
- Cross-module calls go through injected services, not direct Prisma access into another module's tables — keeps the seam clean for a future service split
- Money fields are `Decimal`, never `Float` — floating point has no place in the ledger

## Testing

```bash
npm run test       # unit
npm run test:e2e   # end-to-end, against a real test database (see .github/workflows/ci.yml)
npm run test:cov   # coverage
```

Before the wallet module ships: add the two integrity checks described in plan.md Section 13 — a concurrent-debit race test and a ledger-sum-vs-balance reconciliation check — as part of CI, not just a manual one-off.
