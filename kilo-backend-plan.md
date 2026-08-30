# Kilo Backend Build Plan

Stack: **NestJS (TypeScript)**, PostgreSQL + PostGIS, Prisma ORM, Redis, BullMQ (background jobs), Socket.io / NestJS Gateways (WebSockets).
Architecture: **Modular monolith**, split into NestJS modules by domain. All endpoints versioned under `/api/v1/`.

---

## 1. Module (NestJS module) breakdown

| Module | Responsibility |
|---|---|
| `AccountsModule` | Auth, OTP, riders, drivers, admins, sessions, RBAC |
| `KycModule` | Driver document upload, facial/NIN verification, approval workflow |
| `ServiceAreasModule` | Geofencing, supported states/cities, area config |
| `WalletModule` | Wallet balances, top-ups, ledger, withdrawals, commission tracking |
| `RidesModule` | Ride booking, fare estimation, dispatch, trip lifecycle, cancellation |
| `LogisticsModule` | Package/freight booking, multi-stop, receiver tracking, proof of delivery |
| `KilowattModule` | Charging stations, battery swap, solar leads |
| `BusinessModule` | Corporate accounts, team members, invoicing, credit |
| `PricingModule` | Tariff configs, fare/pricing rules, ride & delivery commission rates |
| `PromoModule` | Promo codes, discounts, redemption tracking *(marked Post-MVP in PRD — see note below)* |
| `PartnershipsModule` | Referral/affiliate program, fleet partners, third-party service partner offers |
| `NotificationsModule` | In-app, push, SMS, email dispatch + preferences + templates |
| `SupportModule` | Tickets, disputes |
| `AdminOpsModule` | Admin dashboard aggregation endpoints, config, broadcast |
| `ReportsModule` | Report generation, exports, scheduled reports |
| `AuditModule` | Immutable audit log for auth, transactions, admin actions |

---

## 2. Endpoints

### 2.1 Auth & Onboarding (`AccountsModule`)

| Method | Path | Description |
|---|---|---|
| POST | `/auth/riders/register` | Create rider account (name, email, phone) |
| POST | `/auth/drivers/register` | Create driver account (personal details) |
| POST | `/auth/otp/send` | Send OTP to phone |
| POST | `/auth/otp/verify` | Verify OTP, activate account |
| POST | `/auth/login` | Login (phone/email + password or OTP) |
| POST | `/auth/logout` | Invalidate session/token |
| POST | `/auth/token/refresh` | Refresh JWT |
| POST | `/auth/password/reset-request` | Trigger password reset |
| POST | `/auth/password/reset-confirm` | Confirm reset with token |
| GET | `/users/me` | Get current user profile |
| PATCH | `/users/me` | Update profile (name, photo, emergency contact) |
| POST | `/admin/staff` | Admin: create support/ops staff account |
| GET | `/admin/staff` | Admin: list staff accounts |

### 2.2 Driver KYC (`KycModule`)

| Method | Path | Description |
|---|---|---|
| POST | `/drivers/{id}/kyc/documents` | Upload license, vehicle reg, roadworthiness, hackney permit |
| POST | `/drivers/{id}/kyc/facial-verification` | Submit facial verification |
| POST | `/drivers/{id}/kyc/government-id` | Submit NIN/government ID for verification |
| GET | `/drivers/{id}/kyc/status` | Get current KYC status |
| GET | `/admin/kyc/pending` | Admin: list drivers pending approval |
| POST | `/admin/kyc/{driver_id}/approve` | Admin: approve KYC |
| POST | `/admin/kyc/{driver_id}/reject` | Admin: reject KYC with reason |

### 2.3 Service Area Validation (`ServiceAreasModule`)

| Method | Path | Description |
|---|---|---|
| POST | `/service-areas/validate` | Check if lat/lng falls in a supported area |
| GET | `/service-areas` | List supported service areas |
| POST | `/admin/service-areas` | Admin: create service area (polygon) |
| PATCH | `/admin/service-areas/{id}` | Admin: update/expand service area |
| DELETE | `/admin/service-areas/{id}` | Admin: remove service area |

### 2.4 Wallet & Payments (`WalletModule`)

| Method | Path | Description |
|---|---|---|
| GET | `/wallet` | Get current user's wallet balance |
| POST | `/wallet/topup` | Initiate top-up (returns payment gateway session) |
| POST | `/wallet/topup/webhook` | Payment gateway webhook (top-up confirmation) |
| GET | `/wallet/transactions` | Transaction history (paginated, filterable) |
| POST | `/wallet/withdraw` | Driver: request withdrawal |
| POST | `/wallet/withdraw/{id}/webhook` | Payout gateway webhook (withdrawal status) |
| GET | `/wallet/commission/outstanding` | Driver: view outstanding commission |
| GET | `/admin/wallets/{user_id}` | Admin: view any user's wallet |
| GET | `/admin/finance/transactions` | Admin: all transactions, filterable |
| GET | `/admin/finance/settlements` | Admin: cash settlement records |
| POST | `/admin/finance/reconcile` | Admin: manual reconciliation action |

### 2.5 Ride Booking (`RidesModule`)

| Method | Path | Description |
|---|---|---|
| GET | `/places/autocomplete` | Address autocomplete proxy (pickup/destination) |
| POST | `/rides/fare-estimate` | Get fare estimate, distance, ETA, route polyline |
| POST | `/rides` | Create ride booking |
| GET | `/rides/{id}` | Get ride details |
| GET | `/rides` | List rider's/driver's rides (history) |
| POST | `/rides/{id}/rate` | Rider rates driver after completion |

### 2.6 Ride Dispatch (`RidesModule`)

| Method | Path | Description |
|---|---|---|
| POST | `/dispatch/{ride_id}/start` | Internal/system: start driver matching |
| POST | `/dispatch/{ride_id}/offers/{driver_id}/accept` | Driver accepts ride offer |
| POST | `/dispatch/{ride_id}/offers/{driver_id}/decline` | Driver declines ride offer |
| WS | `driver:offers` (namespace `/drivers/{id}`) | Driver: receive live ride/delivery offers via Socket.io gateway |
| POST | `/drivers/{id}/status` | Driver: set online/offline/ride-mode/logistics-mode |
| POST | `/drivers/{id}/location` | Driver: push live GPS location (also acceptable as a WS event for lower latency) |
| WS | `ride:tracking` (namespace `/rides/{id}`) | Rider: live driver location + status stream via Socket.io gateway |

### 2.7 Trip Management (`RidesModule`)

| Method | Path | Description |
|---|---|---|
| POST | `/rides/{id}/arrived` | Driver marks arrived at pickup |
| POST | `/rides/{id}/start` | Driver starts trip |
| POST | `/rides/{id}/complete` | Driver completes trip (triggers fare calc + payment) |
| GET | `/rides/{id}/receipt` | Get digital receipt |

### 2.8 Ride Cancellation (`RidesModule`)

| Method | Path | Description |
|---|---|---|
| POST | `/rides/{id}/cancel` | Rider or driver cancels ride |
| GET | `/admin/rides/cancellations` | Admin: cancellation reports |

### 2.9 Logistics — Kilometers (`LogisticsModule`)

| Method | Path | Description |
|---|---|---|
| POST | `/deliveries/quote` | Get price estimate + vehicle recommendation |
| POST | `/deliveries` | Create package/freight booking |
| POST | `/deliveries/{id}/stops` | Add/edit/remove multi-stop destinations |
| GET | `/deliveries/{id}` | Get delivery details |
| GET | `/deliveries` | List deliveries (sender/driver/business history) |
| POST | `/deliveries/{id}/accept` | Driver accepts delivery job |
| POST | `/deliveries/{id}/pickup-confirm` | Driver confirms package pickup |
| POST | `/deliveries/{id}/complete` | Driver marks delivery complete (POD required) |
| POST | `/deliveries/{id}/proof-of-delivery` | Upload OTP/signature/photo proof |
| POST | `/deliveries/{id}/cancel` | Cancel delivery |
| GET | `/track/{tracking_token}` | Public: receiver tracking (no auth) |
| POST | `/track/{tracking_token}/otp/verify` | Public: receiver OTP verification |
| GET | `/admin/deliveries` | Admin: monitor all deliveries |
| POST | `/admin/deliveries/{id}/assign` | Admin: manually assign delivery |
| POST | `/admin/deliveries/{id}/dispute` | Admin: resolve delivery dispute |

### 2.10 Business Accounts (`BusinessModule`)

| Method | Path | Description |
|---|---|---|
| POST | `/business` | Create company profile |
| GET | `/business/{id}` | Get company profile |
| POST | `/business/{id}/team-members` | Invite team member |
| GET | `/business/{id}/team-members` | List team members |
| DELETE | `/business/{id}/team-members/{user_id}` | Remove team member |
| POST | `/business/{id}/deliveries/schedule` | Schedule recurring/bulk deliveries |
| GET | `/business/{id}/invoices` | List invoices |
| GET | `/business/{id}/invoices/{invoice_id}` | Invoice detail |
| POST | `/business/{id}/invoices/{invoice_id}/pay` | Pay invoice |
| GET | `/business/{id}/credit` | Get credit limit + outstanding balance |
| POST | `/admin/business/{id}/credit-limit` | Admin: set/update credit limit |
| GET | `/admin/business` | Admin: list all business accounts |

### 2.11 Tariffs & Commissions (`PricingModule`)

| Method | Path | Description |
|---|---|---|
| GET | `/pricing/tariffs/active` | Internal: resolve active tariff for a vehicle type + service area (used by fare estimation in `RidesModule`/`LogisticsModule`) |
| GET | `/admin/pricing/tariffs` | Admin: list tariff configs (base fare, per-km rate, per-min rate, minimum fare, cancellation fee) |
| POST | `/admin/pricing/tariffs` | Admin: create a tariff for a vehicle type + service area |
| PATCH | `/admin/pricing/tariffs/{id}` | Admin: update a tariff |
| DELETE | `/admin/pricing/tariffs/{id}` | Admin: deactivate a tariff |
| GET | `/admin/pricing/commissions` | Admin: list commission rates by service type/vehicle type |
| POST | `/admin/pricing/commissions` | Admin: create a commission rule |
| PATCH | `/admin/pricing/commissions/{id}` | Admin: update a commission rate |

### 2.12 Promo Codes (`PromoModule`)

> **Scope note:** the PRD lists Promo Codes under *Out of Scope (Post-MVP)*. Endpoints below are included per your request — worth a quick call on whether this ships in MVP or as a fast-follow right after, since it touches fare calculation and the wallet debit flow in `RidesModule`/`LogisticsModule`.

| Method | Path | Description |
|---|---|---|
| POST | `/admin/promos` | Admin: create promo code (type: percentage/flat, value, usage limits, validity window, applicable services) |
| GET | `/admin/promos` | Admin: list promo codes |
| PATCH | `/admin/promos/{id}` | Admin: update or disable a promo |
| DELETE | `/admin/promos/{id}` | Admin: remove a promo |
| POST | `/promos/validate` | Rider: validate a promo code against a draft booking before confirming |
| GET | `/users/me/promos/redemptions` | Get own redemption history |
| GET | `/admin/promos/{id}/redemptions` | Admin: view redemption stats for a promo |

### 2.13 Partnerships (`PartnershipsModule`)

Covers three distinct partner types — referral/affiliate, fleet partners, and third-party service partners.

**Referral / affiliate**

| Method | Path | Description |
|---|---|---|
| POST | `/referrals/generate` | Rider/driver: generate own referral code |
| GET | `/referrals/me` | Get own referral stats (invites, conversions, earnings) |
| POST | `/referrals/redeem` | Apply a referral code at signup |
| GET | `/admin/referrals` | Admin: view referral program performance |
| POST | `/admin/referrals/payouts` | Admin: process referral payouts |

**Fleet partners** (companies supplying multiple drivers/vehicles)

| Method | Path | Description |
|---|---|---|
| POST | `/admin/fleet-partners` | Admin: onboard a fleet partner company |
| GET | `/admin/fleet-partners` | Admin: list fleet partners |
| GET | `/admin/fleet-partners/{id}` | Fleet partner detail |
| POST | `/admin/fleet-partners/{id}/drivers` | Attach a driver to a fleet partner |
| GET | `/admin/fleet-partners/{id}/drivers` | List drivers under a fleet partner |
| GET | `/admin/fleet-partners/{id}/earnings` | Fleet-level earnings report |

**Third-party service partners** (insurance, telco data bundles, etc. surfaced in-app)

| Method | Path | Description |
|---|---|---|
| GET | `/partner-offers` | Rider/driver: list available partner offers |
| GET | `/partner-offers/{id}` | Offer detail |
| POST | `/partner-offers/{id}/claim` | Claim/redeem an offer |
| POST | `/admin/partner-offers` | Admin: create a partner offer listing |
| PATCH | `/admin/partner-offers/{id}` | Admin: update or toggle an offer |
| GET | `/admin/partner-offers/{id}/claims` | Admin: view claim/redemption stats |

### 2.14 Kilowatt — Energy (`KilowattModule`)

| Method | Path | Description |
|---|---|---|
| GET | `/charging-stations` | List/search nearby, with filters (charger/connector/speed) |
| GET | `/charging-stations/{id}` | Station detail |
| POST | `/battery-swap/stations` | List nearby swap stations + wait times |
| POST | `/battery-swap/reservations` | Reserve a swap slot |
| GET | `/battery-swap/reservations/{id}` | Get reservation status |
| POST | `/solar-assessments` | Submit solar assessment request |
| GET | `/admin/charging-stations` | Admin: manage stations |
| POST | `/admin/charging-stations` | Admin: add station |
| PATCH | `/admin/charging-stations/{id}` | Admin: update station/availability |
| GET | `/admin/battery-swap/reservations` | Admin: view all reservations |
| GET | `/admin/solar-leads` | Admin: list solar leads |
| PATCH | `/admin/solar-leads/{id}` | Admin: update lead status / assign rep |

### 2.15 Notifications (`NotificationsModule`)

| Method | Path | Description |
|---|---|---|
| GET | `/notifications` | Get user's notification list (paginated) |
| POST | `/notifications/{id}/read` | Mark notification as read |
| POST | `/notifications/read-all` | Mark all as read |
| GET | `/notifications/preferences` | Get notification preferences |
| PATCH | `/notifications/preferences` | Update preferences (channel/category toggles) |
| POST | `/devices/register` | Register device push token (FCM) |
| DELETE | `/devices/{token}` | Unregister device token |
| POST | `/admin/notifications/broadcast` | Admin: send broadcast notification |
| POST | `/admin/notifications/targeted` | Admin: send targeted notification (segment) |
| POST | `/admin/notifications/schedule` | Admin: schedule a notification |
| GET | `/admin/notifications/history` | Admin: notification delivery history/status |

### 2.16 Support (`SupportModule`)

| Method | Path | Description |
|---|---|---|
| POST | `/support/tickets` | Create support ticket |
| GET | `/support/tickets` | List own tickets |
| GET | `/support/tickets/{id}` | Ticket detail + thread |
| POST | `/support/tickets/{id}/reply` | Reply to ticket |
| GET | `/admin/support/tickets` | Admin: list all tickets (filterable) |
| POST | `/admin/support/tickets/{id}/assign` | Admin: assign to agent |
| POST | `/admin/support/tickets/{id}/escalate` | Admin: escalate ticket |
| POST | `/admin/support/tickets/{id}/resolve` | Admin: close ticket |

### 2.17 Admin Dashboard (`AdminOpsModule`)

| Method | Path | Description |
|---|---|---|
| GET | `/admin/dashboard/summary` | Aggregate counts: riders, drivers, trips, revenue, etc. |
| GET | `/admin/dashboard/live-map` | Live positions: online drivers, active trips/deliveries |
| GET | `/admin/riders` | List/search riders |
| GET | `/admin/riders/{id}` | Rider detail |
| POST | `/admin/riders/{id}/suspend` | Suspend rider |
| POST | `/admin/riders/{id}/activate` | Reactivate rider |
| GET | `/admin/drivers` | List/search drivers |
| GET | `/admin/drivers/{id}` | Driver detail |
| POST | `/admin/drivers/{id}/suspend` | Suspend driver |
| POST | `/admin/drivers/{id}/activate` | Reactivate driver |
| GET | `/admin/config` | Get platform config (commission %, debt limits, pricing rules) |
| PATCH | `/admin/config` | Update platform config |
| GET | `/admin/audit-logs` | Query audit trail |

### 2.18 Reports & Analytics (`ReportsModule`)

| Method | Path | Description |
|---|---|---|
| GET | `/admin/reports/riders` | Rider growth/activity/retention report |
| GET | `/admin/reports/drivers` | Driver utilization/acceptance/earnings report |
| GET | `/admin/reports/rides` | Trip volume, completion, revenue-per-trip |
| GET | `/admin/reports/logistics` | Delivery volume, success rate, vehicle utilization |
| GET | `/admin/reports/business` | Business account activity, invoice volume |
| GET | `/admin/reports/kilowatt` | Charging/swap/solar lead reports |
| GET | `/admin/reports/finance` | Revenue, commissions, settlements |
| GET | `/admin/reports/support` | Ticket volume, resolution time, CSAT |
| POST | `/admin/reports/export` | Export any report as CSV/PDF |
| POST | `/admin/reports/schedule` | Schedule a recurring report |

---

## 3. Third-party services to set up

All of these have official or well-maintained community Node/TypeScript SDKs, which is one of the reasons Node was the stronger fit here — no need to fall back to raw HTTP clients for any of them.

| Category | Provider options | Used for |
|---|---|---|
| **Maps & geolocation** | Google Maps Platform (Places, Directions, Distance Matrix, Geocoding) or Mapbox | Autocomplete, route polylines, ETA/distance, reverse geocoding |
| **SMS + OTP** | Termii or Africa's Talking (Nigeria-focused) / Twilio Verify (global) | Phone verification, receiver tracking SMS, delivery OTP |
| **Push notifications** | Firebase Cloud Messaging (covers both Android and iOS) | All push notification delivery |
| **Email** | **Resend** (recommended) | Receipts, KYC status, invoices, account emails |
| **Payment gateway** | Paystack or Flutterwave (Nigeria-focused) | Wallet top-up, invoice payments, card tokenization |
| **Payout/disbursement** | Paystack Transfers / Flutterwave Payouts | Driver withdrawals to bank |
| **Identity/KYC verification** | Smile Identity, Youverify, or Prembly/QoreID | NIN verification, facial/liveness verification, license/document checks |
| **Object storage** | **Cloudflare R2** (recommended) | KYC documents, proof-of-delivery photos, signatures, profile pictures |
| **Error tracking / APM** | Sentry (+ optionally Datadog/New Relic) | Exception tracking, performance monitoring |
| **PDF generation** | `@react-pdf/renderer` or Puppeteer/headless Chrome | Receipts, invoices, report exports |

**On R2:** good call — it's S3-compatible (same AWS SDK v3 client, just a different endpoint), so nothing in the plan above changes. The real win is zero egress fees, which matters here specifically because KYC documents, POD photos, and signatures get *read* a lot (admin review, dispute resolution, re-verification) relative to how often they're written. S3 would meter every one of those reads; R2 doesn't.

**On Resend vs. SendGrid/Postmark/SES:**

| | Resend | SendGrid | Postmark | AWS SES |
|---|---|---|---|---|
| DX / Node-TS fit | Best-in-class — built by the React Email team, first-class TS SDK | Mature but dated SDK/API | Good, simple API | Bare-bones, verbose |
| Templating | React Email components (write emails as JSX, actually testable) | Dynamic templates via web UI | Templates via web UI | None built-in |
| Deliverability track record | Newer, generally good, smaller volume history | Long track record, industry standard | Excellent for transactional specifically | Excellent but needs reputation warm-up |
| Pricing at MVP scale | Competitive, generous free tier | Comparable | Slightly pricier per-email | Cheapest at scale |
| Maturity risk | Youngest company of the four — worth knowing if you're risk-averse on vendor longevity | Established | Established | Established (AWS) |

For a NestJS + TypeScript stack, **Resend is the right pick** — every email you send here (receipts, invoices, KYC status, password reset) is transactional and template-driven, and writing those templates as React Email components you can actually unit-test beats maintaining templates in a third-party web UI. The only reason to lean SES instead is if you're already deep in AWS infra and want to consolidate billing/vendors — otherwise Resend wins on DX without giving up much on deliverability for transactional volume.

## 4. Infra dependencies (self-hosted / managed)

- PostgreSQL 15+ with PostGIS extension
- Redis (BullMQ broker, Socket.io adapter for multi-instance WebSockets, driver geo-index via GEO commands, caching)
- BullMQ workers + repeatable jobs (scheduled reports, reminders, debt-limit checks)
- Object storage bucket (S3-compatible)
- Node process running NestJS with a WebSocket gateway (Socket.io, backed by the Redis adapter so it works across multiple instances)

## 5. Suggested NestJS project scaffolding

```
src/
  accounts/
  kyc/
  service-areas/
  wallet/
  rides/
  logistics/
  kilowatt/
  business/
  pricing/
  promo/
  partnerships/
  notifications/
  support/
  admin-ops/
  reports/
  audit/
  common/          # guards, interceptors, decorators, pipes
  integrations/     # payment, sms, push, kyc-provider, maps clients
  prisma/            # schema.prisma, migrations
```

Each domain module keeps its own controller, service, DTOs, and Prisma models scoped to it where possible; cross-module calls go through injected services, not direct DB access, to preserve the seam for a future service split.

## 6. Suggested build order

1. **Foundation**: `AccountsModule`, auth, service areas, audit logging, config
2. **Pricing core**: tariffs + commission rules — needed before ride booking can calculate a real fare
3. **Wallet core**: ledger, top-up + payment gateway integration, transaction history
4. **Rides**: booking → dispatch → trip lifecycle → payment → cancellation (the core loop)
5. **Notifications**: in-app + push, since every module above depends on it
6. **KYC + driver onboarding**: unblocks real driver supply
7. **Admin dashboard core**: user/driver management, live monitoring
8. **Logistics (Kilometers)**: reuses dispatch/trip/wallet infra from rides
9. **Business accounts**: invoicing, credit, team management
10. **Kilowatt**: charging stations, battery swap, solar leads
11. **Reports & analytics**, support/ticketing — layered on top once data exists
12. **Promo codes**: layer in once fare calc and wallet debit flow are stable — confirm MVP-vs-fast-follow first
13. **Partnerships**: referral/affiliate, fleet partners, third-party offers — none of these block the core loop, good candidates for a later phase or a parallel workstream

---

## 7. Security

**Auth & session**
- Short-lived JWT access tokens (~15 min) + rotating refresh tokens stored server-side (revocable — a stolen long-lived JWT with no revocation path is a real liability at this scale)
- Argon2id for password hashing (stronger than bcrypt against GPU cracking, and Node has solid native bindings)
- OTP endpoints rate-limited per phone number *and* per IP, with exponential backoff — this is the most-attacked endpoint on any ride-hailing platform (OTP-bombing, account enumeration)
- 2FA mandatory for admin/staff accounts (they can suspend drivers, approve KYC, touch financial data — higher blast radius than a rider account)
- Device/session management: users can view and revoke active sessions

**Transport & edge**
- TLS 1.2+ everywhere, HSTS enforced
- WAF + DDoS protection at the edge (Cloudflare — pairs naturally with R2) in front of the load balancer, filtering L7 attacks before they reach NestJS instances
- CORS locked to known origins (Rider/Driver/Admin app domains only)
- `helmet` middleware for standard security headers

**Data protection**
- Encrypt PII at rest: NIN, KYC documents, driver license numbers — column-level encryption or an encrypted storage class, not just "the disk is encrypted"
- Never touch raw card data — payment gateway hosted checkout/tokenized flow only, which keeps you at PCI-DSS SAQ-A (lightest compliance tier) instead of full PCI scope
- R2/S3 objects (KYC docs, POD photos) served via short-lived signed URLs, never public buckets
- NDPR compliance (Nigeria Data Protection Regulation) given NIN handling — data retention limits, right-to-erasure flow, documented lawful basis for processing

**API-level**
- Every mutating endpoint validated via DTOs (`class-validator`) — reject malformed input before it touches a service
- Global rate limiting (`@nestjs/throttler` backed by Redis so limits hold across instances) — per-user and per-IP tiers, with tighter limits on OTP, login, and payment-initiating endpoints specifically
- RBAC enforced via guards on every admin/staff endpoint, scoped to the minimum role needed (e.g. support agents shouldn't be able to touch commission config)
- Webhook endpoints (Paystack, Flutterwave, Termii, Resend) verify the provider's HMAC signature before processing anything — an unverified webhook endpoint is an open door to fake "payment successful" events
- Dependency scanning (Dependabot/Snyk) in CI, and a pen test pass before public launch

---

## 8. Scaling for high request volume

**Application layer**
- NestJS instances are stateless (no in-memory session/user data) so they scale horizontally behind a load balancer with no special handling — this is the main architectural payoff of keeping auth stateless via JWT
- Load balancer: AWS ALB / NGINX / Cloudflare Load Balancing, health-checked, with autoscaling (ECS Fargate / Kubernetes HPA) triggered on CPU + request-count metrics, not just CPU alone — I/O-bound traffic (webhook calls, DB queries) doesn't always show up as CPU pressure

**The WebSocket wrinkle**
- Socket.io needs either sticky sessions on the load balancer *or* the Redis adapter so events broadcast correctly across instances — at "millions of requests" scale, use the Redis adapter, since sticky sessions undermine even load distribution and complicate autoscaling
- Driver location updates are the highest-frequency event in the system (every few seconds, per online driver) — don't write every ping straight to Postgres. Write to Redis (GEO commands, O(log n) nearest-driver lookups) and batch-persist to Postgres periodically for history, not on every ping

**Data layer**
- PostgreSQL: read replicas for reporting/admin-dashboard queries so they never contend with the booking/dispatch write path; PgBouncer for connection pooling (Node's per-instance connection count adds up fast under load)
- Partition high-volume tables by time (`rides`, `wallet_transactions`, `location_history`) — keeps indexes small and queries fast as data grows into the millions of rows
- At genuinely high throughput, consider a message queue (Kafka or RabbitMQ) ahead of Redis/BullMQ for event streaming (dispatch events, location pings, notification fan-out) — Redis/BullMQ is the right MVP choice, but Kafka is the honest answer if "millions of requests" is a near-term reality rather than an aspiration, since it durably persists and replays events under load in a way Redis-backed queues aren't designed for

**CDN**
- Static assets and any cacheable public data (e.g. charging station list) served through a CDN edge cache, not hit-per-request on the origin

---

## 9. Caching strategy

| What | Where | Pattern |
|---|---|---|
| Driver live location | Redis (GEO) | Write-through, source of truth for "nearest driver" queries |
| Active tariffs / commission config | Redis, cache-aside | TTL + explicit invalidation on `PATCH /admin/pricing/*` so a commission change doesn't wait out a TTL |
| Service area polygons | Redis, cache-aside | Rarely changes — long TTL, explicit invalidation on admin update |
| Charging station list/status | Redis, cache-aside | Short TTL (seconds) — status changes reasonably often but doesn't need to be real-time-exact for a locator screen |
| Rate limit counters | Redis | Sliding window counters, shared across all app instances |
| Idempotency keys (see below) | Redis, with DB backup | Short-to-medium TTL, matched to realistic client retry windows |
| Session/refresh token metadata | Redis | Enables instant revocation without a DB round-trip on every request |

General rule: cache **reference/config data** aggressively (tariffs, service areas, station metadata) since it changes rarely and is read constantly, and invalidate it explicitly the moment an admin changes it — never let a stale commission rate or tariff sit around waiting for a TTL to expire, since that's a direct financial correctness issue, not just a UX staleness issue.

---

## 10. Payment integrity — no duplicate charges, no compromised funds flow

This is the part where "the client retried the request" or "the webhook fired twice" must never translate into a double charge or double credit. Three layers:

**1. Idempotency keys on every payment-initiating request**
Every client-initiated payment action (`POST /wallet/topup`, `POST /wallet/withdraw`, `POST /business/{id}/invoices/{id}/pay`) requires an `Idempotency-Key` header generated client-side per user action. The server:
- Checks Redis (with a DB fallback for durability) for that key before doing anything
- If seen before: returns the original response, does *not* reprocess
- If not seen: processes the request, stores the key → result mapping, then responds
This means a flaky network causing the client to retry a top-up request three times results in **one** charge, not three, regardless of how many times the HTTP request actually hits the server.

**2. Idempotent webhook processing**
Payment gateways (Paystack, Flutterwave) retry webhooks on non-2xx responses or timeouts — by design, you *will* receive the same "payment successful" event more than once. Handling:
- Every webhook payload carries the gateway's own transaction reference — store it with a **unique DB constraint**, so a duplicate insert fails at the database level even if application logic somehow lets it through
- Webhook handler is wrapped in a DB transaction: verify signature → check if reference already processed → if not, credit wallet + record transaction atomically → if yes, return 200 and do nothing
- Never trust a client-side "payment successful" callback alone — always independently verify the transaction status via a server-to-server call to the gateway's verify API before crediting anything

**3. Wallet debit/credit concurrency control**
The actual danger case isn't just retries — it's two concurrent requests touching the same wallet at once (e.g. a ride payment and a withdrawal request landing in the same moment). Handling:
- Wallet balance changes happen inside a DB transaction using row-level locking (`SELECT ... FOR UPDATE`) on the wallet row, so concurrent writes serialize instead of racing
- Ledger is **append-only, double-entry**: every transaction writes two ledger rows (debit + credit) that must balance; balance is either derived from the ledger or maintained as a materialized value updated only within the same locked transaction — never mutated independently of a ledger entry
- A nightly reconciliation job compares Kilo's ledger totals against the payment gateway's settlement report and flags any mismatch for manual review — this is the safety net that catches anything the above three layers somehow miss

Net effect: a request can be retried any number of times, a webhook can fire any number of times, and two requests can land in the same millisecond — none of them should be able to produce a wallet balance that doesn't match reality. This is worth building carefully now (this connects directly to the wallet ledger schema we agreed to come back to) rather than retrofitting after real money has moved through a race condition.

---

## 11. Handling bursty load — thousands of requests/sec without breaking

The Node process is rarely the bottleneck for this kind of traffic. A single NestJS instance can comfortably handle several thousand req/sec on lightweight I/O-bound endpoints (reads, cache hits) — what actually breaks first is the database, a couple of specific hot paths, and anything that talks to a slow third party synchronously. Handle those four things and horizontal scaling of the app layer just works.

**1. Database connections are the real ceiling**

Postgres has a hard `max_connections` limit (default 100, tuned instances go higher but not infinitely). If you run 20 NestJS instances each holding a 20-connection pool, that's 400 connections before you've served a single extra request — you'll exhaust Postgres long before you exhaust the app layer.
- Put **PgBouncer** in transaction-pooling mode between the app and Postgres — it multiplexes thousands of logical client connections onto a small number of real Postgres connections. This is non-negotiable at this scale, not a nice-to-have.
- Keep per-instance Prisma pool size small (5–10) and rely on PgBouncer to absorb the fan-out, rather than giving each instance a large pool.
- Read replicas take reporting/admin-dashboard traffic off the primary entirely, so a spike in admin report-pulling can never starve the booking/payment write path.

**2. The dispatch/location hot path never touches Postgres synchronously**

Driver location updates and nearest-driver lookups are the highest-frequency operations in the system by a wide margin (every online driver, every few seconds). These stay in **Redis GEO** end to end — write on ping, query on dispatch, batch-flush to Postgres periodically for history. If this path round-trips to Postgres per request, it's the first thing to fall over under load, well before anything else does.

**3. Circuit breakers on every third-party call**

At thousands of req/sec, a slow downstream (payment gateway, maps API, SMS provider having a bad day) doesn't just slow those specific requests — it holds open connections and event-loop time across the whole instance, which cascades into everything else queuing behind it. Wrap every third-party call with:
- A hard timeout (fail fast rather than hang)
- A circuit breaker (e.g. `opossum`) that trips after repeated failures and short-circuits further calls for a cooldown window, instead of letting every new request pile onto an already-struggling dependency
- Fallback behavior where possible (e.g. if fare estimation's distance-matrix call times out, fall back to a cached/approximate estimate rather than failing the whole booking flow)

**4. Push non-critical work off the request path entirely**

Anything that doesn't need to block the HTTP response goes onto BullMQ instead of running inline: notification fan-out, receipt email generation, report generation, non-blocking parts of webhook processing. This keeps request-handling threads free to actually handle requests instead of doing side-work synchronously, and it naturally absorbs bursts — a spike in ride completions becomes a deeper queue, not a wall of timeouts.

**Autoscaling that reacts correctly**

Scale out on **request latency and queue depth**, not CPU alone — this workload is I/O-bound, so CPU can look fine while requests are actually piling up waiting on the DB or a slow downstream. Health checks (liveness + readiness probes) need to be strict enough that the load balancer pulls a struggling instance out of rotation before it drags down aggregate latency, and deploys/scale-downs need graceful shutdown (stop accepting new requests, finish in-flight ones, then exit) so a scaling event never itself causes dropped requests.

**Load testing before you trust any of this**

Don't take the above on faith — load test it. Use **k6** or **Artillery** to simulate realistic burst patterns (not just steady-state — ride-hailing traffic spikes hard around rush hours, weather events, etc.) against staging, specifically targeting: booking creation, dispatch/matching, wallet top-up, and the WebSocket location-tracking path under concurrent connections. This tells you the actual breaking point per endpoint rather than an assumed one, and it's the only way to know your PgBouncer pool sizing and autoscaling thresholds are right before real traffic finds the gap for you.

**Indexing checklist** (easy to miss, expensive when missed): `rides.status` + `rides.driver_id`, `wallet_transactions.user_id` + `created_at`, `drivers.status` + geospatial index on last-known-location, `notifications.user_id` + `read_at`. Every one of these is on a query pattern that runs constantly under load — an unindexed filter here is the kind of thing that works fine in dev with 50 rows and falls over at 5 million.

---

## 12. Architecture concept triage — now / later / at deployment

Legend: 🟢 **Now** (build this into the MVP) · 🟡 **Later** (revisit post-MVP or when scale actually demands it) · 🔵 **Deployment/Ops** (set up once as part of shipping, then it runs itself) · ⚪ **Not applicable** (doesn't fit this architecture — noted so it's a conscious skip, not an oversight)

### Traffic & resilience

| Concept | When | Why, for Kilo specifically |
|---|---|---|
| Rate Limiting | 🟢 Now | Already in the plan — `@nestjs/throttler` + Redis, tighter limits on OTP/login/payment |
| Caching | 🟢 Now | Section 9 — tariffs, service areas, station status, driver location |
| Load Balancing | 🔵 Deployment | ALB/NGINX in front of stateless NestJS instances |
| Reverse Proxies | 🔵 Deployment | Same layer as LB — Cloudflare or NGINX terminates TLS, forwards to app |
| API Gateways | 🟡 Later | A dedicated gateway (Kong etc.) is redundant right now — Nest's own guards/throttler + Cloudflare cover it. Revisit if you expose partner/public APIs (fleet partners, third-party offers) needing separate auth/quota tiers |
| Circuit Breakers | 🟢 Now | Section 11 — wraps payment gateway, maps API, SMS calls |
| Timeouts | 🟢 Now | Every outbound third-party call needs one — pairs directly with circuit breakers |
| Retries | 🟢 Now | Only on genuinely idempotent operations (see Idempotency below) — never blind-retry a payment mutation |
| Exponential Backoff | 🟢 Now | Applies to retries above and to webhook redelivery handling |
| Idempotency | 🟢 Now | Section 10 — this is the load-bearing piece of the whole payment integrity story |
| Backpressure | 🟢 Now | BullMQ queue depth as the release valve under burst load (Section 11) |

### Messaging & events

| Concept | When | Why |
|---|---|---|
| Message Queues | 🟢 Now | BullMQ for notifications, reports, non-blocking webhook work |
| Pub/Sub | 🟢 Now | Redis pub/sub via the Socket.io adapter — required the moment you run >1 instance with WebSockets |
| Event-Driven Architecture | 🟡 Later | Full domain-event-driven design (services reacting to a shared event stream) is more than a modular monolith with direct service calls + a job queue needs right now |
| Distributed Transactions | 🟡 Later | Only becomes a real problem once state is split across separate databases/services — one Postgres instance with proper DB transactions covers MVP entirely |
| Saga Pattern | 🟡 Later | Same trigger as above — needed if/when a workflow spans multiple independently-deployed services |
| Dead Letter Queues | 🟢 Now | BullMQ DLQ for failed jobs — a silently-dropped payment webhook or notification job is a real cost, not a nice-to-have |
| Cron Jobs | 🟢 Now | BullMQ repeatable jobs for reconciliation, debt-limit checks, scheduled reports |

### Real-time

| Concept | When | Why |
|---|---|---|
| WebSockets | 🟢 Now | Core to dispatch and live tracking — already central to the design |
| Long Polling | ⚪ N/A | WebSockets already cover the real-time need; adding this too is redundant complexity |
| Server-Sent Events | ⚪ N/A | Same reasoning — SSE would only make sense if you *didn't* need bidirectional WS, but dispatch requires bidirectional |

### Data layer

| Concept | When | Why |
|---|---|---|
| Database Indexing | 🟢 Now | Checklist already in Section 11 |
| Query Optimization | 🟢 Now | Ongoing discipline, not a one-time task — review with every new endpoint |
| N+1 Queries | 🟢 Now | Watch this specifically with Prisma `include`s on nested reads (rides with driver + wallet + location, etc.) |
| Connection Pooling | 🟢 Now | PgBouncer — Section 11, non-negotiable at scale |
| Read Replicas | 🟡 Later | Add once admin/reporting read load is actually measurable against the primary — don't provision this before you have the traffic to justify it |
| Sharding | 🟡 Later | A single well-indexed, partitioned Postgres instance goes a long way past MVP scale — sharding is a last resort, not a starting point |
| Partitioning | 🟡 Later (design for it now) | Table partitioning by date for `rides`/`wallet_transactions` — don't implement until volume justifies it, but design the schema so it's a straightforward add later, not a rewrite |
| Replication | 🔵 Deployment | Postgres streaming replication underlies both read replicas and failover — set up as part of DB provisioning |
| Leader Election | ⚪ Handled | BullMQ's repeatable jobs already dedupe across instances — you'd only need this if running your own cron per-instance, which you're not |

### Consistency & concurrency

| Concept | When | Why |
|---|---|---|
| CAP Theorem | 🟢 Now (as a design lens) | Not an action item, but decide explicitly per feature: wallet = strict consistency; notification delivery, cached tariffs = eventual consistency is fine |
| Eventual Consistency | 🟢 Now | Applies to notification fan-out, cache propagation, reporting reads |
| Optimistic Locking | 🟢 Now | Ride-offer acceptance — only one driver should win a race on the same offer; version-check prevents double-acceptance |
| Pessimistic Locking | 🟢 Now | Wallet debit/credit via `SELECT ... FOR UPDATE` — Section 10 |
| Distributed Locks | 🟢 Now | Redis-based lock for any cross-instance critical section dispatch touches (e.g. assigning a ride to exactly one driver when multiple dispatch workers are racing) |
| Race Conditions | 🟢 Now | The design lens behind all four rows above — applies anywhere two requests can touch the same entity concurrently |
| Deadlocks | 🟢 Now | Mitigate by always locking rows in a consistent order (e.g. wallet before ledger, never the reverse) — a design rule, not a tool |
| Memory Leaks | 🔵 Deployment/ops | Caught via APM (Sentry performance / heap snapshots) in staging load tests, not something you design against upfront |
| Garbage Collection | ⚪ Low priority | V8's GC rarely needs manual tuning at this scale — revisit only if profiling shows it's an actual bottleneck |
| Thread Safety | ⚪ Mostly N/A | Node's single-threaded event loop sidesteps most of this class of bug — relevant only if you introduce worker threads for CPU-heavy work (e.g. PDF generation), which you can isolate when it comes up |

### Scaling & deployment

| Concept | When | Why |
|---|---|---|
| Autoscaling | 🔵 Deployment | Section 11 — latency/queue-depth triggers, not CPU alone |
| Horizontal Scaling | 🟢 Now (design), 🔵 (deploy) | The whole app is designed stateless from day one specifically so this works without rearchitecting |
| Vertical Scaling | 🟡 Later | Fine as a cheap early lever (bigger instance) before horizontal autoscaling is worth the setup cost |
| CDN | 🔵 Deployment | Static assets + cacheable public reads (station lists) |
| Edge Caching | 🔵 Deployment | Same layer as CDN, via Cloudflare |
| Cache Invalidation | 🟢 Now | Explicit invalidation on admin config writes — Section 9 |
| Docker | 🟢 Now | Containerize from the start — this is how local dev, CI, and every deploy target stay consistent, don't bolt it on later |
| CI/CD | 🟢 Now | Set up the pipeline (lint → test → build → deploy) in week one, not after the app exists — retrofitting CI onto an established codebase is always more painful |
| Kubernetes | 🟡 Later | ECS Fargate (or equivalent managed container service) is simpler to operate at MVP scale with no dedicated platform team — move to K8s if/when you need its specific flexibility, not by default |
| Service Discovery | 🟡 Later | Only matters once you have multiple independently-deployed services calling each other — irrelevant inside a modular monolith |
| Feature Flags | 🟢 Now (lightweight) | Directly solves the promo-codes MVP-vs-post-MVP question from earlier — a simple flag table/service is enough, don't reach for a paid platform yet |
| Blue-Green Deployments | 🔵 Deployment | Decide the deploy strategy before first production release, not after an incident teaches you why it matters |
| Canary Releases | 🟡 Later | Worth adopting once you have enough traffic that a canary sample is statistically meaningful |
| Rolling Deployments | 🔵 Deployment | Reasonable default for MVP — simpler than blue-green/canary, fine at this scale |
| Rollbacks | 🔵 Deployment | Must be a tested, one-command action before launch — not something you improvise during an incident |

### Observability & ops

| Concept | When | Why |
|---|---|---|
| Health Checks | 🔵 Deployment | Required for the load balancer to pull unhealthy instances |
| Liveness & Readiness Probes | 🔵 Deployment | Same as above, container-orchestrator-specific |
| Monitoring | 🟢 Now | Sentry from day one — retrofitting observability after an incident is the wrong order of operations |
| Logging | 🟢 Now | Structured JSON logs from day one, correlate with request IDs |
| Distributed Tracing | 🟡 Later | OpenTelemetry is worth adding once you have enough service boundaries (even within the monolith) that a single log line doesn't tell the whole story |
| Metrics | 🟢 Now (basic) | Request latency, error rate, queue depth — the load-testing numbers from Section 11 should feed real dashboards, not just a one-time test report |
| Alerting | 🔵 Deployment | Tied to the metrics above — define thresholds before launch, not after the first 3am incident |
| SLOs / SLIs | 🟡 Later | Formal SLOs are easier to set meaningfully once you have real production traffic patterns — start with the PRD's 99.9% uptime target as the working number |
| Error Budgets | 🟡 Later | Follows naturally once SLOs exist |
| Observability | 🟢 Now (foundation) | The umbrella of the rows above — start now, deepen later |

### Security

| Concept | When | Why |
|---|---|---|
| Secrets Management | 🟢 Now | Never `.env` files in production — AWS Secrets Manager / Vault from the first deploy |
| IAM | 🔵 Deployment | Least-privilege cloud roles as part of infra provisioning |
| OAuth | 🟡 Later | First-party JWT auth covers riders/drivers/admin now — add OAuth if/when you expose APIs to external partners (fleet partners, third-party integrations) |
| JWT Rotation | 🟢 Now | Refresh token rotation — Section 7 |
| TLS | 🔵 Deployment | Enforced at the edge/load balancer |
| Encryption at Rest | 🟢 Now | PII/KYC data — Section 7 |
| Encryption in Transit | 🔵 Deployment | TLS everywhere, internal service calls included |
| WAF | 🔵 Deployment | Cloudflare, in front of the load balancer |
| DDoS Protection | 🔵 Deployment | Same layer as WAF |
| CORS | 🟢 Now | Locked to known app origins from the first endpoint |
| CSRF | 🟢 Now | Relevant for any cookie-based session flows (likely just the admin dashboard, if it's not purely token-in-header) |
| SQL Injection | 🟢 Now | Prisma parameterizes queries by default — the discipline is to never drop to raw SQL without parameterization |
| XSS | 🟢 Now | Sanitize any user-generated content that admin dashboard renders (support ticket messages, delivery notes) |
| SSRF | 🟢 Now | Relevant anywhere the backend fetches a user-supplied URL — worth an explicit check if webhooks or partner integrations ever accept callback URLs |

### Data lifecycle & DR

| Concept | When | Why |
|---|---|---|
| Database Migrations | 🟢 Now | Prisma Migrate from the first schema |
| Schema Versioning | 🟢 Now | Same practice, applies to API contracts too |
| Disaster Recovery | 🔵 Deployment | Documented plan before launch, not drafted after data loss |
| Backups | 🔵 Deployment | Automated Postgres backups + point-in-time recovery from day one of production |
| Failover | 🔵 Deployment | Tied to Postgres replication setup |
| Multi-Region Deployments | 🟡 Later | The PRD's own scope explicitly puts multi-country expansion post-MVP — matches this |
| Chaos Engineering | 🟡 Later | A maturity-stage practice, valuable once you have a stable baseline to test against |

### Misc / protocol-level

| Concept | When | Why |
|---|---|---|
| Cost Optimization | 🟡 Later (ongoing) | Right-size infra once you have real usage data — optimizing against guessed traffic wastes effort |
| Cold Starts | ⚪ N/A | Not running serverless for the core API (stateful WS + always-on dispatch don't fit that model) |
| Serverless Limits | ⚪ N/A | Same reasoning — irrelevant to this architecture |
| Latency / Throughput / P99 / Tail Latency | 🟢 Now | These are exactly what the k6/Artillery load testing in Section 11 should be measuring — define target numbers before you build, verify after |
| Network Partitions | 🟡 Later | A single-region MVP has far less exposure to this than a multi-region setup would — revisit alongside multi-region |
| Clock Skew | 🔵 Deployment | NTP-synced servers, store all timestamps in UTC — a five-minute setup step that prevents a subtle class of bug later |
| DNS | 🔵 Deployment | Standard infra setup |
| TCP vs UDP | ⚪ N/A | Not a decision point — HTTP and WebSockets both run over TCP here, no reason to introduce UDP |
| HTTP/2 & HTTP/3 | 🔵 Deployment | Enable at the CDN/load balancer level — Cloudflare does this with effectively no extra work |
| gRPC | ⚪ N/A (for now) | Only earns its complexity once you split into services calling each other internally at volume — not relevant inside a modular monolith |
| Webhooks | 🟢 Now | Already core to the payment/SMS integrations — Section 10 |
| API Versioning | 🟢 Now | `/api/v1/` from the first endpoint |
| Semantic Versioning | 🟢 Now | Lightweight practice for internal packages/releases |
| Infrastructure as Code | 🟢 Now | Terraform from the first environment — manually clicking through a cloud console is the thing that becomes unmaintainable fastest |
| Terraform | 🟢 Now | Same as above |
| Helm Charts | 🟡 Later | Only relevant once/if you move to Kubernetes |
| Build Caching | 🔵 Deployment | Docker layer caching + npm cache in CI — cheap win, set it up when you build the pipeline |
| Dependency Hell | 🟢 Now (ongoing) | Lockfiles + Dependabot/Renovate from day one |
| Production Incidents | 🔵 Deployment | Process (not tooling) — define severity levels and escalation before you need them |
| On-call | 🔵 Deployment | Define rotation and paging tool before launch |
| Postmortems | 🔵 Deployment | Blameless postmortem template ready before the first incident, not written during it |

### The short version

If you only take five things from this table into the build starting **now**: **Docker + CI/CD from week one, idempotency on every payment mutation, PgBouncer before you hit connection limits, monitoring/logging from the first deploy (not after an incident), and Infrastructure as Code instead of manual cloud console setup.** Everything tagged 🟡 Later is genuinely fine to defer — building it prematurely (Kubernetes, sharding, distributed transactions, multi-region) adds real operational cost for scale you don't have yet.

---

## 13. Wallet ledger design

Full schema: see `wallet-ledger.prisma` (companion file). Core principles:

- **Double-entry, every transaction**: debits always equal credits within a `Transaction`. Enforced at the application layer when constructing entries — worth adding a DB-level check constraint or a nightly integrity job that sums entries per transaction and flags any that don't net to zero, since this invariant is exactly the kind of thing a future code change could accidentally violate.
- **Append-only**: `LedgerEntry` rows are never updated or deleted. Corrections are new `REFUND` or `MANUAL_ADJUSTMENT` transactions that reference the original via `reversesTransactionId`.
- **`Account.balance` is materialized, not authoritative** — it's a performance cache, always written in the same DB transaction as the `LedgerEntry` rows that justify the change, via the atomic conditional `UPDATE ... WHERE balance >= $amount` pattern. The ledger itself is the source of truth; a reconciliation job can always recompute balance from `SUM(credits) - SUM(debits)` per account and compare against the cached value.
- **Platform accounts make external money flow explicit** — `PLATFORM_GATEWAY_CLEARING` represents the boundary with the actual payment gateway, so a top-up or withdrawal is a real, balanced ledger movement rather than a special-cased balance mutation.
- **`DRIVER_COMMISSION_PAYABLE` and `BUSINESS_CREDIT_PAYABLE` are liabilities, not wallets** — this is what lets cash-ride commission tracking and business invoicing live in the same ledger model as wallet payments, instead of being bolted on as separate ad-hoc counters.

**Two integrity checks worth running in CI/staging before this touches real money:**
1. A property-based or scenario test that fires concurrent debit requests against the same wallet and asserts the balance never goes negative and never double-processes.
2. A reconciliation script that sums ledger entries per account and diffs against `Account.balance` — run it against seeded test data as a CI check, then daily in production.

Next natural step once this is scaffolded: the `WalletModule` service methods that construct these transactions (`topUp`, `payForRide`, `settleCommission`, `requestWithdrawal`, `refund`) — each one is really just "build a balanced set of ledger entries, wrap in a DB transaction, update materialized balances atomically."

---

## 14. Build roadmap — task breakdown

Each task is scoped to be independently buildable and testable before moving to the next. Order follows Section 6's build order, broken into concrete units.

### Phase 0 — Foundation
- [ ] **Task 1: Project scaffold** — NestJS project structure, TypeScript config, Prisma init, Docker + docker-compose (Postgres + Redis local dev), env config module, base CI pipeline (lint/test/build)
- [ ] **Task 2: Core Prisma schema** — User/Rider/Driver/Admin base models, wire in the wallet-ledger schema, first migration
- [ ] **Task 3: Auth module** — registration, OTP send/verify, login, JWT + refresh token rotation, RBAC guards
- [ ] **Task 4: Service area validation** — geofencing check, admin CRUD for service areas

### Phase 1 — Money & pricing (needed before rides can work end-to-end)
- [ ] **Task 5: Wallet module core** — the `topUp`/`payForRide`/`settleCommission`/`requestWithdrawal`/`refund` service methods on top of the ledger schema
- [ ] **Task 6: Payment gateway integration** — Paystack/Flutterwave top-up flow + webhook handler (signature verification, idempotent processing)
- [ ] **Task 7: Pricing module** — tariff config, fare calculation, commission rules

### Phase 2 — The core ride loop
- [ ] **Task 8: Ride booking** — fare estimate, address autocomplete proxy, booking creation
- [ ] **Task 9: Dispatch** — nearest-driver matching (Redis GEO), offer/accept/decline flow, WebSocket gateway for driver offers
- [ ] **Task 10: Trip lifecycle** — arrived/start/complete, live tracking WebSocket, receipt generation
- [ ] **Task 11: Cancellation** — rider/driver cancellation, fee calculation

### Phase 3 — Supporting systems
- [ ] **Task 12: Notifications module** — in-app + push (FCM), templates, preferences, BullMQ-based fan-out
- [ ] **Task 13: KYC module** — document upload (R2), facial/NIN verification integration, admin approval workflow
- [ ] **Task 14: Admin dashboard core** — user/driver management endpoints, dashboard summary aggregation

### Phase 4 — Logistics & business
- [ ] **Task 15: Logistics module** — package/freight booking, multi-stop, receiver tracking (public, no-auth), proof of delivery
- [ ] **Task 16: Business accounts** — company profiles, team members, invoicing, credit

### Phase 5 — Kilowatt & extras
- [ ] **Task 17: Kilowatt module** — charging station locator, battery swap, solar leads
- [ ] **Task 18: Reports module** — operational/financial reports, CSV/PDF export
- [ ] **Task 19: Support module** — ticketing, escalation

### Phase 6 — Deferred-scope modules (revisit MVP-vs-fast-follow decision first)
- [ ] **Task 20: Promo codes**
- [ ] **Task 21: Partnerships** — referral/affiliate, fleet partners, third-party offers

### Ongoing, not sequential
- Load testing (k6/Artillery) — run against each phase's endpoints as they land, not just once at the end
- Security review pass — per Section 7, especially before Phase 1 (money) and Task 13 (KYC/PII) ship
- Terraform/IaC for whichever cloud target is chosen — can start in parallel with Phase 0
