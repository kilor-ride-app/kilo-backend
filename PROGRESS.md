# Kilo Backend — Progress & Setup Checklist

Living document. Two jobs:
1. **Build log** — what's actually been built, task by task, against the roadmap in `kilo-backend-plan.md` Section 14.
2. **Credentials checklist** — every external credential the app needs, what it unlocks, and whether it's set yet — so nothing gets missed before deploy.

Update this file whenever a task lands or a new credential gets added, in the same session that does the work.

---

## 1. Status at a glance

| # | Task | Status |
|---|---|---|
| 1 | Project scaffold | ✅ Done |
| 2 | Core Prisma schema | ✅ Done |
| 3 | Auth module | ✅ Done — went well beyond the original scope (see below) |
| 4 | Service area validation | ✅ Done |
| 5 | Wallet module core | ✅ Done |
| 6 | Payment gateway integration (Paystack) | ✅ Done — code complete, **untested against a real Paystack account** |
| 7 | Pricing module | ✅ Done |
| 8 | Ride booking | ✅ Done |
| 9 | Dispatch | ✅ Done |
| 10 | Trip lifecycle | ✅ Done |
| 11 | Cancellation | ✅ Done |
| 12 | Notifications module | ✅ Done |
| 13 | KYC module | ✅ Done — **document upload against real R2 now live-verified** (see credentials checklist); facial/government-ID verification still untested against real Smile Identity credentials |
| 14 | Admin dashboard core | ✅ Done |
| 15 | Logistics module | ✅ Done |
| 16 | Business accounts | ✅ Done — Phase 4 complete |
| 17 | Kilowatt module | ✅ Done |
| 18 | Reports module | ✅ Done — code complete, **PDF export not implemented, CSV only (see below)** |
| 19 | Support module | ✅ Done — Phase 5 complete |
| 20 | Promo codes | ✅ Done — built as a fast-follow per user decision (plan.md flagged this as needing an MVP-vs-fast-follow call) |
| 21 | Partnerships | ✅ Done — Phase 6 complete, all 21 tasks from the roadmap now built |
| — | Driver guarantor verification | ✅ Done — **not in the original plan**, built on direct request (extends KYC module — see below) |

**Next up:** none — every task in `kilo-backend-plan.md` Section 14 is now built. Remaining work is the credentials checklist below (real third-party accounts) and the "before going to production" list in Section 3.

---

## 2. Build log

### Task 1 — Project scaffold
NestJS structure, Docker Compose (Postgres/PostGIS + Redis + PgBouncer), env config, CI pipeline skeleton.

**Fixed along the way:**
- PgBouncer defaulted to `auth_type=md5`, which can't complete SCRAM auth against Postgres 15/16 — set `AUTH_TYPE=scram-sha-256` in `docker-compose.yml`.
- `prisma migrate` can't run through PgBouncer's transaction-pooling mode (no `CREATE DATABASE` for the shadow DB) — added `directUrl`/`DIRECT_URL` to bypass it for migrations only.
- No ESLint config existed at all (`npm run lint` errored outright) — added `.eslintrc.js` + `.prettierrc.json`.

### Task 2 — Core Prisma schema
`User`, `OtpCode`, `RefreshToken`, `ServiceArea`, plus the full wallet ledger (`Account`, `Transaction`, `LedgerEntry`, `IdempotencyKey`, `WithdrawalRequest`) — double-entry, append-only.

### Task 3 — Auth module
Built well past the original "registration, OTP, login, JWT, RBAC" scope, per follow-up requests:
- Registration (rider/driver), phone OTP send/verify, password login (phone or email), JWT access + rotating opaque refresh tokens (reuse-detection burns all sessions), logout
- **RBAC, two layers:** coarse `UserRole` (rider/driver/admin/super-admin) + a real `Role`/`Permission` system for fine-grained staff permissions (`manager`, `finance`, `logistics`, `support` roles seeded via `npm run seed:permissions`)
- **Invite-based staff onboarding** — `POST /admin/staff/invites` takes just `{email, roleIds}`; invitee fills in name/phone/password on accept. Every invited account becomes coarse `ADMIN`; the fine-grained roles do the real gating.
- **Email verification** — OTP-based, shares the same `OtpService` core as phone OTP. `pendingEmail` field means changing your email never touches the already-verified one until the new one is confirmed.
- **Social login (Google + Apple, rider-only)** — ID-token verification (not OAuth redirect — the standard pattern for native apps). New signups still require phone OTP verification like every other account.
- **Real email sending activated** — React Email templates (`verification-code-email.tsx`, `staff-invite-email.tsx`) rendered server-side, sent via Resend.

**Bugs hit and fixed:**
- `jwks-rsa`'s CJS export has no `.default` — added `esModuleInterop: true` to `tsconfig.json` (not a one-off workaround).
- Social-login deps (`google-auth-library`, `jsonwebtoken`, `jwks-rsa`) landed in `devDependencies` due to this environment's `npm` config — moved to `dependencies` (the Docker prod build runs `npm ci --omit=dev`, would've shipped broken).

### Task 4 — Service area validation
Point-in-polygon geofencing (ray-casting) against GeoJSON polygons, admin CRUD gated by the `service-areas.manage` permission. Built the first shared `RedisService`/`RedisModule` (cache-aside, explicit invalidation on writes) — nothing like it existed before this, despite Redis already being used for BullMQ/Throttler.

### Task 5 — Wallet module core
The five ledger methods from plan.md Section 13 (`topUp`, `payForRide`, `settleCommission`, `requestWithdrawal`, `refund`), all funneling through one atomic double-entry primitive. Platform accounts (`PLATFORM_REVENUE` etc.) are seeded once via script, not lazily created — `@@unique([ownerId, type])` doesn't actually protect against duplicates when `ownerId` is null (Postgres treats `NULL != NULL`).

**Real bug caught by live testing:** the sufficiency guard (`balance >= amount` before a debit) was applied uniformly to every account, which broke the very first top-up — you can't have a "sufficient balance" requirement on a platform suspense account that starts at zero. Fixed: the guard only applies to accounts with a real owner; platform accounts debit unconditionally.

### Task 6 — Payment gateway integration
Paystack: initialize/verify transaction, resolve account number, create transfer recipient, initiate transfer, HMAC-SHA512 webhook signature verification. The `Idempotency-Key` interceptor promised in the README back in Task 3. Driver top-ups auto-deduct against outstanding commission before crediting spendable balance.

**Deliberate deviation from the plan's endpoint table:** real Paystack has one global webhook URL per account, not one per transaction — built `POST /wallet/webhooks/paystack` (single endpoint, switches on event type) instead of the plan's `POST /wallet/withdraw/{id}/webhook`.

**Not yet verified live** — see the credentials checklist below. Code-reviewed but unverified: the interceptor's successful-response caching, and its reject-on-reused-key-different-body path.

### Task 7 — Pricing module
`Tariff` + `CommissionRule` (new schema — didn't exist before). Cache-aside via `RedisService`, same pattern as service areas. "At most one active tariff per vehicle type + area" enforced at the application layer (DB constraint would block keeping deactivated history).

### Tasks 8–11 — Ride booking, Dispatch, Trip lifecycle, Cancellation (Phase 2, built together)
New schema: `Ride`, `RideOffer`, `RideRating`, `DriverStatus`. Driver *location* deliberately isn't a column anywhere — it lives entirely in Redis GEO (plan.md Section 8), Postgres only ever sees state transitions.

- **Booking (Task 8)** — `POST /rides/fare-estimate` and `POST /rides` both resolve a tariff via `PricingService` and a distance via Google Distance Matrix if `GOOGLE_MAPS_API_KEY` is set, else a haversine-based approximation (plan.md Section 11: "fall back to a cached/approximate estimate rather than failing the whole booking flow"). `GET /places/autocomplete` has no fallback (can't guess addresses) — returns `503` until the Maps key is set.
- **Dispatch (Task 9)** — `DispatchService` does a Redis `GEOSEARCH` around pickup, filters candidates by `DriverStatus` (online + vehicle type) in Postgres, fans out `RideOffer` rows to the nearest N simultaneously with a 15s TTL, pushed live over a `DriverOffersGateway` WebSocket. First driver to accept wins via an atomic `UPDATE...WHERE status=DISPATCHING AND driverId=null` guard — this **is** the optimistic lock plan.md calls for; no separate Redis lock needed on top of it. A `RideTrackingGateway` lets a rider subscribe to one ride's room (membership checked server-side, never trusted from the client) and receive live status + location pushes.
- **Trip lifecycle (Task 10)** — arrived/start/complete, wallet payment on completion via `WalletService.payForRide`. Added a **6th** wallet method here, `recordCashRideCommission` — Task 5 deliberately deferred "how does a cash ride's commission debt get recorded" to whichever task built trip completion; this was that task. Uses `PLATFORM_GATEWAY_CLEARING` as the accrual-time counterparty (not `PLATFORM_REVENUE`) specifically so revenue is only recognized once `settleCommission` actually collects it, never while the debt is still outstanding.
- **Cancellation (Task 11)** — free before a driver commits (`REQUESTED`/`DISPATCHING`/`NO_DRIVERS_FOUND`); once `ACCEPTED`/`ARRIVED`, a rider-initiated cancellation charges the tariff's `cancellationFee`, split with the driver via the same `payForRide` path a real fare uses.

**Known simplifications, deliberately scoped down:**
- Dispatch is a single round (offer → 15s TTL → `NO_DRIVERS_FOUND` if nobody accepts) — no multi-round retry with an expanding radius. The round-expiry timer is a plain `setTimeout`, not a durable BullMQ job — doesn't survive a process restart.
- `finalFare` at trip completion is the original estimate, not recomputed from the actual GPS trace.
- `POST /drivers/{id}/status`, `/location`, and `/dispatch/{rideId}/offers/{driverId}/*` keep the plan's literal `{id}`-in-path shape, but every path ID is checked against the authenticated caller — a driver can only ever act as themselves.

**Verified live, full path (WALLET payment):** driver goes online + pushes location → rider gets a fare estimate (haversine fallback) → books a ride → driver receives the offer over WebSocket in real time → accepts (second accept attempt correctly rejected, `409`) → arrived → start → complete → **wallet math confirmed exact** (fare 2429.46, 18% commission → driver 1992.16, rider debited exactly 2429.46) → rated → receipt → rider-tracking WS subscribe/ack/status/location all confirmed live → cancellation with fee (exact deduction) and free cancellation (no driver committed) both confirmed → admin cancellations report + RBAC rejection confirmed → WS auth rejection confirmed for both wrong-role and invalid-token connections.

**Verified live, separately (CASH payment — the Task 5 gap this task closed):** first pass only checked the WALLET path and the summary claimed the whole thing was done without actually completing a CASH ride — caught and fixed in the same session. Re-tested properly: booked and completed a `paymentMethod: CASH` ride → confirmed `Ride.transactionId` stayed `null` → confirmed `RIDER_WALLET` balance was untouched → confirmed `DRIVER_WALLET` (spendable balance) got **no new ledger entry** from this ride → confirmed `DRIVER_COMMISSION_PAYABLE` increased by exactly the commission amount (437.30) → confirmed `PLATFORM_GATEWAY_CLEARING` decreased by exactly that same amount (unguarded, as designed) → then ran `settleCommission` against that real accrued debt and confirmed it zeroed out and `PLATFORM_REVENUE` only increased at that settlement step, never at accrual.

### Follow-up — cash-ride commission cap + withdrawal auto-deduction
Two things prompted by direct follow-up questions, not in the original roadmap:

- **`DriverStatus.unsettledCashRideCount`** — increments every time `WalletService.recordCashRideCommission` fires, resets to 0 only when `settleCommission` brings the payable balance to exactly zero (a partial payment doesn't lift the cap). Once a driver hits **3** unsettled cash rides, `DispatchService` stops offering them cash rides at all (filtered out of the candidate list before an offer is even created) — a driver at the cap can still take `WALLET` rides freely; the cap is payment-method-specific, not a blanket suspension. A second, defense-in-depth check exists at accept time too.
- **Withdrawal auto-deduction** — `POST /wallet/withdraw` now settles any outstanding cash-ride commission out of the requested amount before anything reaches the bank. The driver's wallet still loses the *full* requested amount (that's what "withdraw X" means to them); `PLATFORM_GATEWAY_CLEARING` only reflects the portion that actually crosses the gateway boundary — mirrors how the existing topup-auto-deduct flow already treats clearing (never counting the internally-settled portion). If the settlement consumes the entire request, no Paystack call happens at all — not even bank-account resolution — and the request completes immediately. If a real transfer is still needed and the gateway call fails, **both** the withdrawal and the settlement get reversed together (not just one), whether the failure is immediate or arrives later via the `transfer.failed` webhook.

**A real bug caught mid-implementation:** the first version resolved/registered the Paystack bank recipient *before* checking whether any transfer was actually needed — meaning a withdrawal fully absorbed by debt still required Paystack to be configured, defeating the point. Fixed: recipient resolution only happens when `transferAmount > 0`.

**Verified live:** 3 cash rides completed → counter hit 3 → a 4th cash-ride booking correctly got `NO_DRIVERS_FOUND` (the only driver excluded) → a `WALLET` ride to the same driver still dispatched normally, confirming the cap doesn't block wallet rides → withdrawal smaller than the debt: fully absorbed, `settledCommission` matched the request exactly, wallet and payable both moved by the exact right amounts, no Paystack call attempted → withdrawal larger than the remaining debt: correctly required Paystack (`503` when unconfigured, exactly as expected) → separately verified via script (can't reach this exact failure point through the real HTTP flow without genuine Paystack sandbox credentials) that the rollback composition itself — refunding both the withdrawal and the settlement together — restores both balances to their exact pre-attempt values.

### Tasks 12–14 — Notifications, KYC, Admin dashboard core (Phase 3, built together)
New schema: `Notification`, `NotificationCampaign`, `NotificationPreference`, `DeviceToken`, `KycDocument`, `KycVerification`, `PlatformConfig`, `AuditLog`. Three new integration wrappers: `R2Service` (S3-compatible object storage via `@aws-sdk/client-s3` + presigned reads), `FcmService` (Firebase Admin, modular `firebase-admin/app` + `firebase-admin/messaging` API — v14 dropped the old namespaced `admin.messaging()` style), `SmileIdentityService`. All three follow the same "cleanly unavailable, never crash" shape as `PaystackService`: no credentials configured → `503`, not a 500.

- **Notifications (Task 12)** — in-app notifications, per-category/per-channel preferences, device token register/unregister, and three admin sending modes: `broadcast` (everyone, no segment), `targeted` (role or explicit user-ID list), `schedule` (targeted + a future `scheduledFor`). Sending fans out through a real BullMQ queue (`NotificationsProcessor`) rather than looping synchronously in the request — first actual BullMQ usage in this codebase. Push delivery goes through `FcmService`; a push send prunes `DeviceToken` rows for tokens FCM reports as no-longer-registered.
- **KYC (Task 13)** — four required document types (license, vehicle registration, roadworthiness, hackney permit) uploaded to R2, plus two Smile-Identity-backed verifications (facial, government ID). `KycService.getStatus()` computes an aggregate status from the **latest submission per type** — a resubmission after rejection supersedes the rejected one rather than being permanently blocked by it. Admin approve/reject is bulk (every currently-PENDING document for a driver at once, matching the plan's endpoint shape — no per-document ID in the path) and writes an `AuditLog` entry. Added one endpoint beyond the plan's table: `GET /admin/kyc/documents/{documentId}/url` — R2 objects are never public, so reviewing an uploaded document means minting a short-lived signed URL on demand.
- **Admin dashboard core (Task 14)** — dashboard summary (counts + `PLATFORM_REVENUE.balance` as the recognized-revenue figure, not a re-derived sum), live-map (reads driver positions straight out of the same Redis GEO set `DispatchService` writes to — `ZRANGE` + `GEOPOS`, filtered to `ONLINE` — plus active `Ride` rows), rider/driver list+search+detail+suspend+activate, and platform config GET/PATCH.
- **Built a small shared `PlatformConfigService`** (its own module, not owned by AdminOps) specifically so `DispatchService`'s cash-ride cap could move off the hardcoded `MAX_UNSETTLED_CASH_RIDES = 3` constant from the earlier follow-up work — it's now `admin/config`-editable (`maxUnsettledCashRides`, cache-aside with explicit invalidation on write, same pattern as tariffs/service-areas), with `3` remaining the default when unset. `RidesModule` imports `PlatformConfigModule`; `AdminOpsModule` does too — no dependency between Rides and AdminOps directly.
- **`PATCH /admin/config`'s body is deliberately not a class-validated DTO** — it's an open key/value bag (current keys: `maxUnsettledCashRides`, more will land as other modules grow admin-tunable settings) typed as a plain `Record<string, unknown>` in the controller signature so the global `ValidationPipe`'s `whitelist: true` doesn't strip unknown keys.
- Four new permissions: `notifications.send`, `admin.users.manage`, `admin.config.edit`, `admin.dashboard.view`, `admin.audit.view` (5, not 4 — `kyc.approve`/`kyc.reject` already existed from earlier). All assigned to the `manager` seed role.

**Verified live (dev server, superadmin + a throwaway test driver account):**
- Dashboard summary and live-map both correct against real DB/Redis state (4 riders, 1 driver, 1 online with real GEO coordinates, revenue figure matched the ledger).
- Admin `PATCH /admin/config` → `GET /admin/config` round-trip confirmed, and the write correctly produced an `AuditLog` row (`config.update`). At the time, the cached `get(key, default)` path `DispatchService` actually calls (as opposed to `getAll()`, used only by the GET endpoint) hadn't been separately exercised end-to-end — **this gap was closed in Task 15's testing below**, which drove `maxUnsettledCashRides` through a real dispatch cycle on both rides and deliveries.
- Notifications: device register/unregister, preferences get/update, admin `targeted` broadcast → confirmed the BullMQ job actually ran (`NotificationCampaign.sentAt` populated, `_count.notifications` correct) → in-app notification appeared in the recipient's list → mark-as-read confirmed → dev-mode FCM fallback log confirmed firing (`[DEV — no FCM_SERVICE_ACCOUNT_JSON set] Push to 1 device(s)`).
- KYC: status aggregation correctly returns `PENDING` with nothing submitted → document upload and facial verification both fail **cleanly** with `503` (R2 / Smile Identity unconfigured), not a 500 → the driver-side `assertSelf` guard correctly rejects (`403`) a driver querying another driver's KYC status → admin pending-list correctly empty.
- Admin user management: search-by-name, detail (rides-by-status breakdown, availability, outstanding commission), suspend, and activate all confirmed against the same throwaway driver, each suspend/activate producing its own `AuditLog` row with the actor ID correctly attributed.
- Throwaway test driver and its notification/OTP/refresh-token rows were deleted after testing; the `AuditLog` rows generated during testing were deliberately **left in place** — audit logs are meant to be an append-only historical record, so cleaning those up specifically would defeat the point.

### Follow-up — R2 credentials configured and live-verified
Real R2 credentials were added and checked directly against Cloudflare (not just format-checked): `HeadBucket`, `PutObject`, `GetObject`, `DeleteObject` all succeeded against the real `kilo` bucket via the AWS SDK client, using the exact same client construction `R2Service` uses.

**A real credential bug caught and fixed in this pass**: the first `R2_ACCOUNT_ID` value supplied was 53 characters with a `cfat_` prefix — not a valid Cloudflare Account ID (which is exactly 32 hex characters, no prefix). Since `R2Service` builds its endpoint as `https://${accountId}.r2.cloudflarestorage.com`, the bad value produced a hostname Cloudflare's edge didn't recognize — the connection failed at the **TLS handshake** stage (`SSL alert number 40`) before any S3 authentication logic even ran. Caught via a direct connection test, not inspection alone. Corrected value (32 hex chars) resolved it completely.

**Verified live end-to-end**: registered a throwaway driver, uploaded a real KYC document (`POST /drivers/{id}/kyc/documents`) → previously returned a clean `503`, now returns `201` with a real `fileKey` → fetched the admin signed-URL endpoint (`GET /admin/kyc/documents/{id}/url`) → downloaded the signed URL directly and confirmed the returned content **byte-for-byte matched** what was uploaded. Both the test KYC document row and the underlying R2 object were deleted afterward.

**Still open**: `SMILE_IDENTITY_PARTNER_ID`/`SMILE_IDENTITY_API_KEY` remain blank — facial/government-ID verification is still untested against a live sandbox, and `SmileIdentityService`'s job-submission contract itself is still unverified (built from general API-shape knowledge, not confirmed docs).

### Task 15 — Logistics module (Phase 4)
New schema: `Delivery`, `DeliveryStop`, `DeliveryOffer`, plus `DriverStatus.serviceMode` (`RIDES` | `LOGISTICS` — a driver is in exactly one line of work at a time, set via the *same* `POST /drivers/{id}/status` endpoint rides already used, now with an optional `serviceMode` field). Per plan.md Section 6 ("Logistics reuses dispatch/trip/wallet infra from rides"), this module deliberately doesn't duplicate the whole rides stack — it reuses what genuinely is shared and only builds a parallel version of what actually differs:

- **Reused directly:** the physical driver pool and Redis GEO location hot path (`drivers:geo` — same key, filtered by `serviceMode` instead of a separate structure), the single per-driver WebSocket connection (`DriverOffersGateway`, exported from `RidesModule` and extended with `delivery:offer`/`delivery:offer:taken`/`delivery:offer:cancelled` events — a driver never needs a second socket just because they switched modes), `PricingService` (new `serviceType: 'DELIVERY'` commission rules, same `Tariff` model with delivery-specific vehicle types like `BIKE`), and two new sibling methods on `WalletService` (`payForDelivery`, `recordCashDeliveryCommission`) that mirror `payForRide`/`recordCashRideCommission` exactly.
- **Deliberately shares the cash-commission debt pool with rides** — `recordCashDeliveryCommission` increments the *same* `DriverStatus.unsettledCashRideCount` counter cash rides use, and a new `LogisticsDispatchService` enforces the *same* `maxUnsettledCashRides` cap (read from the `PlatformConfigService` built in Task 14) before offering a driver a cash delivery. This closes a real loophole: without a shared pool, a driver capped out on cash-ride debt could dodge the cap entirely by switching to logistics mode. `DispatchService` (rides) was also updated to only match `serviceMode: RIDES` drivers, so the isolation is bidirectional.
- **Built separately:** `LogisticsDispatchService` (delivery-offer matching — same GEOSEARCH-then-Postgres-filter shape as `DispatchService`, but an 8km radius / 20s offer TTL instead of rides' 5km / 15s, since a delivery job has more to read before deciding), `LogisticsTripService` (pickup-confirm → proof-of-delivery → complete, POD required before completion), `LogisticsService` (quote, create, multi-stop edit, list/get, cancel, public tracking), `AdminLogisticsService` (list, manual assign, dispute resolution with an optional wallet refund via the existing `WalletService.refund`).
- **Multi-stop** is a flat `POST /deliveries/{id}/stops` that replaces the whole stop list in one call (add/edit/remove are all just "here's the new list") — matches the plan's single endpoint for all three operations. Editable only before a driver has accepted (`REQUESTED`/`DISPATCHING`); each edit recomputes distance/fare by summing Distance-Matrix-or-haversine legs pickup→stop1→stop2→...
- **Proof of delivery is a whole-delivery concept, not per-stop** — matches the plan's single (not per-stop) POD endpoint. Three types: `OTP` (driver enters the code the receiver read out, checked against a hash generated at booking time), `SIGNATURE`/`PHOTO` (uploaded to R2, same pattern as KYC documents — never a public URL).
- **Public receiver tracking** (`GET /track/{trackingToken}`, `POST /track/{trackingToken}/otp/verify`) — no auth at all, the token itself is the credential. `main.ts`'s global-prefix exclusion needed both routes listed explicitly (NestJS excludes by exact route pattern, not prefix). Deliberately excludes package value, fare, and the sender's identity from the public response; includes a live driver position read straight off the same Redis GEO set, same technique `AdminOpsService`'s live-map uses. The receiver OTP + tracking link are sent via a new generic `SmsService.sendMessage()` (extracted from the auth-only `sendOtp()`, which now just calls it).
- `haversineDistanceKm`/`approximateRoadDistance` moved from `src/rides/utils/` to `src/common/utils/` — genuinely shared, not rides-specific, and Logistics needed it for multi-leg distance summation.
- Reused the existing `logistics.manage` permission (seeded back in Task 12) for every admin endpoint — no new permissions needed this task.

**A real bug caught by live testing, fixed in the same pass:** `LogisticsDispatchService.findNearbyDrivers` was built *without* the cash-cap filter at all — copy-adjusting `DispatchService`'s query for the `serviceMode` change dropped the `unsettledCashRideCount` clause entirely, so a capped-out driver still received cash-delivery offers (verified: created a cash delivery for a driver at the cap, got an offer instead of `NO_DRIVERS_FOUND`). Fixed by porting the same filter (dispatch-time) and the same defense-in-depth check (accept-time) from `DispatchService`, reading the shared `maxUnsettledCashRides` config key. Re-tested and confirmed fixed.

**Verified live (dev server, superadmin + throwaway driver/sender accounts, real BIKE tariff + DELIVERY commission rule created via the admin pricing endpoints):**
- `POST /deliveries/quote`: multi-stop distance correctly summed leg-by-leg; with a `vehicleType` returns one quote, without it returns quotes across every active tariff sorted cheapest-first with `recommended` flagged correctly.
- Full WALLET lifecycle: create → dispatch matched only the `LOGISTICS`-mode driver (confirmed a `DeliveryOffer` row was created) → offer correctly expired after the 20s TTL when unaccepted (`NO_DRIVERS_FOUND`, mirroring rides' round-timer) → admin manual-assign → pickup-confirm → proof-of-delivery (wrong OTP correctly rejected `400`, correct OTP accepted) → complete → **ledger confirmed exact**: sender debited 1476.31, driver credited 1254.86, `PLATFORM_REVENUE` credited 221.45 (15% of 1476.31) → driver flipped back to `ONLINE` with `serviceMode` preserved as `LOGISTICS` (not reset to rides).
- Full CASH lifecycle: same flow, `transactionId` correctly stayed `null`, `DELIVERY_PAYMENT_CASH` transaction confirmed debiting `PLATFORM_GATEWAY_CLEARING` and crediting `DRIVER_COMMISSION_PAYABLE` by the exact commission amount, `unsettledCashRideCount` incremented.
- **Shared cash-cap enforcement** (the point of unifying the counter): with the driver's counter forced to the configured cap, a new cash delivery correctly got zero offers / `NO_DRIVERS_FOUND` (after the bug above was fixed) — a `WALLET` delivery to the same still-capped driver dispatched normally, confirming the cap stays payment-method-specific, not a blanket suspension.
- **Bidirectional mode isolation**: with the driver in `LOGISTICS` mode, a new ride booking correctly got `NO_DRIVERS_FOUND` (zero ride offers) — confirming `DispatchService`'s new `serviceMode: RIDES` filter works, not just the delivery side.
- Multi-stop create + edit: adding a second stop via `POST /deliveries/{id}/stops` correctly recomputed distance/fare (matched the earlier quote for the same route) and returned the updated stop list.
- Public tracking: `GET /track/{trackingToken}` (no auth) returned status/stops/driver-first-name/live-position while correctly omitting fare and package value; `POST /track/{trackingToken}/otp/verify` correctly validated the receiver's code.
- Cancellation: free before a driver commits (`REQUESTED`/`DISPATCHING`, fee `0`) → after admin-assign (driver committed), sender-initiated cancellation correctly charged the tariff's cancellation fee (300).
- Admin dispute resolution with `refund: true`: correctly reversed the original `DELIVERY_PAYMENT_WALLET` transaction via the existing `WalletService.refund` — verified all three ledger entries flipped direction and both balances landed back at their exact pre-transaction values, original transaction marked `REVERSED`.
- `PHOTO` proof-of-delivery correctly failed **cleanly** with `503` (R2 unconfigured), not a 500.
- Throwaway driver/sender accounts and every delivery/transaction/ledger-entry/account row they touched were fully deleted after testing (no audit-log equivalent exists for this module yet, so nothing needed preserving). The `BIKE` tariff and `DELIVERY` commission rule created for testing were **left in place** as reusable seed data, matching how Phase 2 left its `ECONOMY`/`RIDE` equivalents.

### Task 16 — Business accounts (Phase 4 complete)
New schema: `Business`, `BusinessTeamInvite`, `Invoice`, plus `User.businessId` and `Delivery.businessId`. Reuses `LogisticsService` directly (exported from `LogisticsModule`) so business-billed deliveries go through the exact same booking/dispatch/tracking path individual senders use — `POST /business/{id}/deliveries/schedule` is a thin wrapper that calls `LogisticsService.createDelivery(...)` per item with a `businessId` attached, not a parallel booking implementation.

- **Company + team** — `POST /business` is a one-way upgrade: any `RIDER` account can start a company (becomes `BUSINESS_ADMIN`, `businessId` set), one business per user in this pass. Team invites (`BusinessTeamInvite`) deliberately mirror `StaffInvite`'s exact email→token→accept shape but stay a separate model — no `Role`/`Permission` grants, just a coarse `BUSINESS_ADMIN`/`BUSINESS_STAFF` choice at invite time. `BUSINESS_STAFF` can view team/schedule deliveries; only `BUSINESS_ADMIN` can invite/remove team members or pay invoices.
- **The hard part — designing a balanced ledger shape for invoiced/credit billing** — took real back-and-forth to get right (see the thinking process): a business-billed delivery can't just swap "debit the payer's wallet" for "credit the payer's payable" the way `payForRide` does, because a payable *increasing* and a wallet *decreasing* are both reductions in the platform's favor — one CREDIT and one DEBIT — and naively substituting one for the other breaks the debit=credit balance. Landed on two independently-balanced transactions (same composition philosophy as the withdrawal auto-deduction from Phase 2's follow-up work):
  - **At delivery completion** (`WalletService.chargeBusinessForDelivery`, mirrors `recordCashRideCommission`'s exact 2-entry shape but for the *full* fare, not just commission): `DEBIT PLATFORM_GATEWAY_CLEARING` / `CREDIT BUSINESS_CREDIT_PAYABLE`. The driver is **not** paid yet and no revenue is recognized yet — both deliberately deferred, same "never recognize revenue before cash is collected" principle the cash-ride design already established, just applied to a business's credit line instead of a driver's cash float. An `Invoice` (one per delivery, `PENDING`, 14-day due date) is created in the same step.
  - **At invoice payment** (`WalletService.payInvoice`, two transactions composed atomically in one DB transaction): (1) `DEBIT BUSINESS_WALLET` / `CREDIT DRIVER_WALLET` (driverAmount) / `CREDIT PLATFORM_REVENUE` (commissionAmount) — the driver is *finally* paid and revenue is *finally* recognized, now that real cash has moved; (2) `DEBIT BUSINESS_CREDIT_PAYABLE` / `CREDIT PLATFORM_GATEWAY_CLEARING` (full amount) — closes out the payable and the clearing exposure opened at completion. Net effect across the full lifecycle: `PLATFORM_GATEWAY_CLEARING` and the payable both return to exactly zero once paid, verified live.
- **Credit limit enforcement is checked at scheduling time** (`BusinessService.assertWithinCreditLimit`, comparing `estimatedFare + current outstanding` against `Business.creditLimit`) — **known simplification**: this only accounts for already-*accrued* (completed, unpaid) debt, not other deliveries currently in-flight but not yet completed, so several simultaneous bookings could technically land slightly over the limit before any of them complete. A real implementation would reserve/hold credit for in-flight jobs too; out of scope here.
- **Invoicing is one invoice per delivery**, not a periodic consolidated statement (no batching/cron job) — a real corporate billing setup would typically want weekly/monthly consolidated invoices; deliberately out of scope for this pass, flagged the same way KYC's Smile Identity integration and dispatch's single-round matching were flagged as intentional MVP simplifications.
- One new permission, `business.manage`, gating `GET /admin/business` and `POST /admin/business/{id}/credit-limit` — assigned to both the `manager` and `finance` seed roles (credit-limit decisions are as much a finance call as an ops one).
- `AccountsModule` now exports `AuthService` (was `exports: []`) so `BusinessService.acceptInvite` can issue a token pair on invite acceptance, mirroring `InvitesService` exactly.

**Verified live (dev server, superadmin + a throwaway rider-turned-business-owner, staff member, and driver, reusing Task 15's `BIKE` tariff and `DELIVERY` commission rule):**
- `POST /business` correctly upgraded the caller to `BUSINESS_ADMIN` with `businessId` set; a second attempt correctly rejected (`403`, already RIDER-gated since the role had already changed).
- Team invite → accept → list confirmed both members present with correct roles. Permission gating confirmed both directions: `BUSINESS_STAFF` correctly got `403` inviting a team member and paying an invoice; `BUSINESS_ADMIN` could do both. A non-member (unrelated driver account) correctly got `403` just trying to view the business.
- **Real Resend sandbox restriction hit during testing, same as Task 3's staff invites**: sending to a non-verified address failed with `403` from Resend itself (not a bug — documented, and matches `InvitesService`'s identical shape/limitation). Retested successfully against the account's own verified address to confirm the send path works; the accept-flow itself was verified against a directly-seeded invite token (same technique used to bypass the same limitation elsewhere in this session).
- Admin `GET /admin/business` and `POST /admin/business/{id}/credit-limit` confirmed; `GET /business/{id}/credit` correctly reflected the limit and a `0` outstanding balance before any activity.
- Scheduled a business-billed delivery via `POST /business/{id}/deliveries/schedule` → confirmed `businessId` attached and it dispatches/tracks exactly like a normal delivery (same `LogisticsDispatchService`, same driver pool) → ran it through accept → pickup-confirm → proof-of-delivery → complete → confirmed `Delivery.transactionId` stayed `null` and an `Invoice` was created `PENDING` with the exact fare (1476.31) and commission (221.45) → confirmed `BUSINESS_CREDIT_PAYABLE` accrued exactly 1476.31 and the driver's wallet had **no** balance yet (deferred, as designed).
- Funded the business's wallet directly, then paid the invoice → **ledger confirmed exact end to end**: business wallet debited 1476.31, driver wallet credited 1254.86 (finally), `PLATFORM_REVENUE` credited 221.45 (finally), `BUSINESS_CREDIT_PAYABLE` returned to exactly `0`, and `GET /business/{id}/credit` reflected the `0` outstanding immediately after.
- Idempotency-Key reuse on `POST .../invoices/{id}/pay` confirmed: retrying with the same key returned the cached response and did **not** double-debit the business wallet.
- Credit-limit rejection confirmed at scheduling time: with accrued debt pushed to just under the limit, a delivery whose estimated fare would exceed it was correctly rejected (`403`) before any booking was created.
- Team member removal confirmed: downgraded back to `RIDER` with `businessId` cleared (not deleted — history stays intact).
- Every throwaway account, delivery, invoice, transaction, and ledger entry created during testing was fully deleted afterward.

### Tasks 17–19 — Kilowatt, Reports, Support (Phase 5 complete)
New schema: `ChargingStation`, `BatterySwapStation`, `BatterySwapReservation`, `SolarAssessment`, `SupportTicket`, `SupportTicketMessage`, `ScheduledReport`. No new payment shape needed — `WalletService.payForKilowattService` is a plain 2-entry transaction (debit the user, credit `PLATFORM_REVENUE` in full) since, unlike a ride or delivery, there's no driver counterparty earning a cut — the "driver" here is platform-owned infrastructure.

- **Kilowatt (Task 17)** — charging-station and battery-swap-station search are small, slow-changing datasets filtered/distance-sorted in application code (haversine, same technique as `ServiceAreasService`) rather than a DB geo query. Battery-swap reservation and payment happen together in one action (the plan's endpoint table has no separate confirm step) — an atomic conditional decrement (`WHERE availableBatteries > 0`) claims the slot the same way the wallet's balance guard works, and if payment then fails, the battery is released back rather than stranded. Wait-time estimation is a flat heuristic (0 min if any battery's available, 15 min if not) — this codebase doesn't track a real per-station queue.
  - **A real gap in the plan's own endpoint table, filled in**: only charging stations got explicit admin CRUD (`POST`/`PATCH /admin/charging-stations`) — battery-swap stations have no admin management endpoints at all in the spec, yet obviously have to be creatable somehow. Added `POST`/`PATCH /admin/battery-swap/stations`, mirroring the charging-station shape exactly (same precedent as adding the KYC document-review and delivery POD signed-URL endpoints earlier — necessary infrastructure the literal table missed).
- **Support (Task 19)** — creating a ticket also creates its first message (the opening description) in one call, so every ticket always has at least one message. Any staff role (`ADMIN`/`SUPER_ADMIN`/`SUPPORT_AGENT`) can reply, not just the specifically assigned agent — assignment is a routing/ownership signal, not an access gate. A staff reply notifies the ticket's creator via `NotificationsService` (reused from Task 12); escalation and resolution do too. Reused the `support.tickets.manage` permission seeded back in Task 12 — no new permission needed.
  - **A real spec inconsistency caught while testing, fixed in the same pass**: the plan's endpoint table literally describes `POST /admin/support/tickets/{id}/resolve` as "Admin: **close** ticket" — but the schema has both a `RESOLVED` and a `CLOSED` status, and `resolve()` was only setting `RESOLVED`, leaving `CLOSED` completely unreachable. Rather than force one endpoint to cover two states or add an unspecified second endpoint, the reply-blocking guard was widened to treat `RESOLVED` the same as `CLOSED` (both end the active thread) — matching the plan's literal "one action, ends the ticket" intent while leaving `CLOSED` defined for a possible future richer lifecycle (e.g. auto-archival after resolution).
- **Reports (Task 18)** — all 8 report endpoints (`riders`, `drivers`, `rides`, `logistics`, `business`, `kilowatt`, `finance`, `support`) are live Prisma aggregations over an optional `from`/`to` window (defaults to the trailing 30 days), not materialized/cached tables. Every report generator returns a flat array of row objects — one element for single-summary reports, multiple rows for naturally tabular ones (e.g. logistics broken out by vehicle type) — so the same shape serves both the JSON `GET` response and CSV export with no separate mapping layer.
  - **CSV export is real and fully working**; **PDF export is deliberately not implemented** — `ReportFormat.PDF` stays in the schema/DTO enum (matching the plan's literal "CSV/PDF" wording) so the gap is visible in the API surface rather than hidden by omission, but `ReportsService.exportCsv` rejects it with a clear `400`, not a fake render. A real PDF renderer (fonts, pagination, layout) wasn't judged worth the added dependency for this pass — CSV covers the actual "get this data out" use case.
  - **Scheduled reports are a genuine recurring BullMQ job**, not a stub: `POST /admin/reports/schedule` creates a `ScheduledReport` row and registers a BullMQ *repeatable* job (fixed cron per frequency — daily/weekly/monthly at 06:00 — rather than admin-supplied cron strings, to avoid validating arbitrary cron syntax from API input) keyed by the schedule's own id, so re-registering is a safe no-op. `ReportsProcessor` (mirrors `NotificationsProcessor`'s shape) regenerates the report on each tick and emails it as a CSV attachment — `EmailService` gained a genuine attachment capability (`sendWithAttachment`, base64-encoded per Resend's raw HTTP API) for this.
  - Support's CSAT metric from the plan's description isn't computed — no rating field was built onto `SupportTicket` in this pass, so it's omitted from the report rather than fabricated; volume, status breakdown, and average resolution time are real.

**A real bug caught by live testing, fixed in the same pass**: `AdminKilowattController.listSolarLeads` originally mixed a single-param `@Query('status')` with a whole-object `@Query() query: PaginationDto` on the same handler — this app's global `ValidationPipe` (`forbidNonWhitelisted: true`) validates the *entire* incoming query string against whichever DTO is bound via a whole-object `@Query()`, so it doesn't know `status` is being consumed by a separate decorator and rejects it as an unknown property. Confirmed live (`400: property status should not exist`). Fixed by extending `PaginationDto` into a proper `ListSolarLeadsQueryDto` with `status` as a real field — the same pattern already used for `ListUsersQueryDto`/`ListTicketsQueryDto` elsewhere in this codebase; grepped the rest of Phase 5's controllers to confirm no other handler had the same mixed-`@Query()` mistake.

**Verified live (dev server, superadmin + a throwaway rider account):**
- Charging stations: created via admin, found correctly by distance (`0km` at the exact coordinates, correctly excluded beyond `radiusKm`), `chargerType` and `minSpeedKw` filters both correctly excluded a non-matching station.
- Battery swap: created a station with 1 available battery → reservation attempt with **no** wallet balance correctly failed (`409`) **and** the battery was confirmed released back (`availableBatteries` returned to `1`, not stranded) → funded the wallet, reserved again → **ledger confirmed exact**: full `2500` debited from `RIDER_WALLET`, full `2500` credited to `PLATFORM_REVENUE`, no split → station correctly dropped out of "0-wait" results and showed `estimatedWaitMinutes: 15` once depleted → reservation-status endpoint correctly rejected (`403`) a non-participant (the admin) trying to view it → admin list-all-reservations confirmed.
- Solar: submitted an assessment → admin list filtered by `status=NEW` confirmed (after the query-DTO bug above was fixed) → status update + rep assignment confirmed.
- Support: full lifecycle confirmed — ticket creation (with its first message) → staff reply flipped status to `IN_PROGRESS` and notified the rider (`Notification` row confirmed with the reply body) → assign → escalate (priority bumped to `URGENT`, `escalatedAt` set, rider notified) → resolve (rider notified) → reply-after-resolve correctly rejected (`403`, after the resolve/close guard fix above) → a rider correctly got `403` hitting the admin-only assign/escalate/resolve endpoints.
- Reports: all 8 `GET` endpoints returned real, sensible aggregates reflecting genuine historical activity accumulated across this entire session (rides, wallet transactions, tickets, kilowatt activity, etc. — not fixtures) → CSV export confirmed with correct `Content-Type: text/csv` / `Content-Disposition: attachment` headers and correct CSV body (verified against the matching `GET` endpoint's JSON) → PDF export confirmed rejected cleanly with `400`, not a `500` → scheduled a weekly report, confirmed the BullMQ repeatable job was actually registered (queried Redis directly via `queue.getRepeatableJobs()`, correct cron pattern and next-run timestamp) → manually triggered the job and confirmed the **full pipeline** end to end: report regenerated, CSV attached, real email sent successfully via Resend (hit the same sandbox-recipient restriction against a non-verified address first, then succeeded against the verified one — consistent with every other email-sending feature this session) → `ScheduledReport.lastRunAt` confirmed updated after the run.
- The test repeatable BullMQ job was removed after verification (`queue.removeRepeatableByKey`) so it doesn't keep firing on a schedule in this dev environment. Every throwaway account, station, reservation, ticket, transaction, and ledger entry created during testing was fully deleted afterward.

### Tasks 20–21 — Promo codes, Partnerships (Phase 6 complete — all 21 roadmap tasks now built)
Promo codes was explicitly flagged in the plan as needing an MVP-vs-fast-follow call before building — **built now as a fast-follow, per direct instruction**, not deferred. New schema: `Promo`, `PromoRedemption`, `ReferralCode`, `ReferralRedemption`, `FleetPartner`, `FleetPartnerDriver`, `PartnerOffer`, `PartnerOfferClaim`.

- **Promo codes (Task 20)** — a discount is applied by reducing `estimatedFare` *before* it ever reaches `WalletService.payForRide`/`payForDelivery` — those methods are completely untouched, so applying a promo carries zero risk to already-verified ledger code. Driver commission is computed off the *discounted* fare (same as it already is off `estimatedFare` with no promo — nothing new there), so the platform's cut scales down proportionally on a promo'd job rather than the platform fully subsidizing the driver. `PLATFORM_PROMO_LIABILITY`/`TransactionType.PROMO_REDEMPTION` (scaffolded back in Task 2) stay unused in this pass — a "platform fully absorbs the discount, driver payout unaffected" model would need them, but that's a materially bigger ledger change than this pass's scope, and `PromoRedemption` rows are themselves a complete, queryable discount-cost record without it. `POST /promos/validate` is a pure preview (never records a redemption); real application happens only through `RidesService.createRide`/`LogisticsService.createDelivery` gaining an optional `promoCode` field — business-billed deliveries are deliberately excluded from promo eligibility (retail promos, not corporate billing).
- **Partnerships (Task 21)** — three sub-domains:
  - **Referrals** — a referral qualifies for payout *immediately* on redemption in this pass, not gated on the referred user completing a first ride/delivery (that gate would need a hook into RidesModule/LogisticsModule completion logic; a reasonable enhancement, not built here — `ReferralRedemptionStatus.PENDING` is defined for that future gate but unreachable today). The bonus amount is admin-configurable via the existing `PlatformConfigService` (`referralBonusAmount`, defaulting to 500) rather than hardcoded. Payout accrual/settlement mirrors `recordCashRideCommission`/`settleCommission`'s exact shape: `PLATFORM_REFERRAL_PAYABLE` is a single platform-wide liability account (aggregate amount owed to referrers collectively), not one per referrer — the per-referrer breakdown lives in queryable `ReferralRedemption` rows instead.
  - **Fleet partners** — earnings reports sum `DRIVER_WALLET` *credit* ledger entries for attached drivers over a period. Known simplification: cash-paid ride/delivery earnings never touch `DRIVER_WALLET` at all in this system's design (the driver keeps the cash directly — see `recordCashRideCommission`), so they're invisible to this report; documented, not an oversight.
  - **Partner offers** — audience-filtered listing (`RIDER`/`DRIVER`/`BOTH`), idempotent claiming via a `(offerId, userId)` unique constraint.
- Reused `support.tickets.manage`-style permission conventions: four new permissions (`promos.manage`, `referrals.manage`, `fleet-partners.manage`, `partner-offers.manage`), assigned to the `manager` role; `referrals.manage` also added to `finance` (payout processing is a finance-adjacent decision).

**A mistake caught and fixed *before* it shipped, not after**: while wiring up `AdminPartnershipsController.listReferrals`, started writing the exact same `@Query('status')` + whole-object `@Query()` mixing mistake that caused a live, testing-confirmed bug in Kilowatt's `listSolarLeads` (Task 17) — this app's `ValidationPipe` (`forbidNonWhitelisted: true`) validates the *entire* query string against whichever DTO is bound via a whole-object `@Query()`, so a separately-bound single param gets rejected as an unknown property. Caught it on inspection before running the code and fixed it the same way as before — a proper `ListReferralsQueryDto extends PaginationDto`.

**Verified live (dev server, superadmin + throwaway rider/driver/referred-user accounts, reusing existing tariffs/commission rules):**
- Promo: `PERCENTAGE` type correctly capped by `maxDiscount` at the boundary (10% of 5000 = 500, capped to exactly 300) and correctly uncapped below it (10% of 2000 = 200) → wrong-service validation correctly rejected (`400`) → booked a **real ride** with a promo code and confirmed `estimatedFare` was exactly `2429.46 × 0.9 = 2186.51` → confirmed a `PromoRedemption` row was created with `referenceId` pointing at the real ride id → `usageLimitPerUser: 1` correctly blocked a second use, even at validate-only time (`409`) → `FLAT` type correctly capped at the fare itself when the flat value would exceed it (500 off a 300 fare → discount `300`, final `0`, not negative) → redemption history and admin stats endpoints both confirmed → disabling a promo correctly made it immediately unresolvable (`404` on validate).
- Referrals: code generation confirmed idempotent (same code both times) → self-redemption correctly rejected (`400`) → a second user redeemed successfully (`QUALIFIED`, earnings defaulted to 500) → duplicate redemption by the same user correctly rejected (`409`) → **ledger confirmed exact** at accrual (`PLATFORM_GATEWAY_CLEARING` debited 500, `PLATFORM_REFERRAL_PAYABLE` credited 500) → referrer stats endpoint confirmed (1 invite, 1 conversion, 500 total earnings) → admin list filtered by `QUALIFIED` status confirmed → `POST /admin/referrals/payouts` processed the payout → **ledger confirmed exact** at payout (`PLATFORM_REFERRAL_PAYABLE` debited 500 back to net `0`, referrer's `RIDER_WALLET` credited 500) → referrer's final wallet balance matched exactly (`10000 - 2429.46 + 500 = 8070.54`).
- Fleet partners: created a partner, attached a driver → re-attaching the same driver correctly rejected (`409`, already attached to a fleet) → driver list confirmed → earnings report **matched exactly** the driver's real completed-ride net earnings from earlier live testing (`2429.46 fare - 437.30 commission = 1992.16`), summed straight from real `DRIVER_WALLET` ledger entries, not a fixture.
- Partner offers: created an `audience: RIDER` offer → correctly visible to a rider's listing, correctly **invisible** to a driver's listing → claim confirmed, duplicate claim correctly rejected (`409`) → admin claim-stats endpoint confirmed → toggling `isActive: false` correctly removed it from the rider's listing immediately.
- Permission gating: a rider correctly got `403` attempting to create a fleet partner.
- Every throwaway account, ride, promo, referral, fleet partner, partner offer, transaction, and ledger entry created during testing was fully deleted afterward.

### Driver guarantor verification (not in the original plan — built on direct request)

Not present anywhere in `kilo-backend-plan.md`. Requested directly: a driver sends a link to a guarantor, the guarantor fills a form and uploads ID/proof-of-address, the submission goes to admin review, and once approved the driver's guarantor status becomes `VERIFIED` — with the driver able to track status at every stage. Built as an extension of `KycModule` rather than a new top-level module — guarantor verification is a sub-domain of driver KYC, reuses `R2Service`/`AuditService` already wired there, and reuses the existing `kyc.approve`/`kyc.reject` permissions instead of minting new ones. New schema: `Guarantor` (`GuarantorStatus`: `INVITED` → `SUBMITTED` → `VERIFIED`/`REJECTED`).

- **Invite/resend is one endpoint, not two** — `POST /drivers/:id/guarantor/invite` mirrors `StaffInvite`/`BusinessTeamInvite`'s raw-token-emailed/hashed-token-stored pattern. If the driver's most recent guarantor row is still `INVITED` (link sent but not yet submitted), the *same* row's token and expiry are rotated instead of creating a new one — an implicit "resend." A `SUBMITTED` or `VERIFIED` row blocks a new invite outright (`409`); a `REJECTED` row is left alone and a fresh row is created, preserving the rejected attempt for admin history rather than overwriting it.
- **Public submission flow has no auth**, mirroring `LogisticsModule`'s public delivery-tracking precedent — `GET /guarantor/:token` (context: driver's name, current status, whether the link can still be submitted) and `POST /guarantor/:token/submit` (multipart, `FileFieldsInterceptor` for two named fields, `idDocument` required and `proofOfAddress` optional) both live under the standard `/api/v1` prefix rather than bypassing it — the track-token's prefix exclusion was judged a one-off stylistic choice for that feature, not a pattern worth extending by default.
- A `GUARANTOR_SELECT` Prisma select-object constant is used on every method returning a `Guarantor` row so `tokenHash` can never leak into a response — same reasoning as never returning a hashed invite/reset token elsewhere in this codebase.
- Admin review (`GET/POST /admin/guarantors/...`) mirrors the KYC document approve/reject shape exactly: audit-logged (`guarantor.approve`/`guarantor.reject`), driver notified either way, signed-URL endpoints for both documents.
- Avoided a bug this session hit twice before (Kilowatt's `listSolarLeads`, live-confirmed; Partnerships' `listReferrals`, caught before running): built `ListGuarantorsQueryDto extends PaginationDto` with `status` as a real field from the first draft, rather than mixing `@Query('status')` with a whole-object `@Query()` on the same handler.

**Verified live (dev server, two throwaway driver accounts + a throwaway `SUPER_ADMIN`):**
- Invite via phone → `Guarantor` row created `INVITED`, dev-mode SMS fallback logged the real invite link/token → public `GET /guarantor/:token` returned the driver's name and `canSubmit: true`.
- Public submit (multipart, real `idDocument` + `proofOfAddress` files) → status flipped to `SUBMITTED`, `submittedAt` set, both files genuinely uploaded to R2 (confirmed byte-for-byte via signed URL against the original upload content), driver notified.
- Driver's own `GET /drivers/:id/guarantor` correctly tracked `SUBMITTED` in real time.
- Admin list filtered by `status=SUBMITTED` returned the submission (confirming the query-DTO fix held) → signed document URLs for both files confirmed byte-for-byte → `POST .../approve` flipped status to `VERIFIED`, `AuditLog` row confirmed (`action: guarantor.approve`), driver notified, driver's own status view confirmed `VERIFIED`.
- Reject path (second driver, invite via email first — hit Resend's sandbox-recipient restriction as expected, non-fatal, caught by the invite's `.catch`; re-invited via phone to get a usable token) → submitted with **no** `proofOfAddress` (confirming it's genuinely optional) → admin reject with a reason → status `REJECTED`, `rejectionReason` stored, `AuditLog` row confirmed (`action: guarantor.reject`), driver notified with the reason as the notification body.
- Edge cases: re-inviting a `VERIFIED` driver's guarantor correctly rejected (`409`) → a driver viewing another driver's guarantor correctly rejected (`403`, via the existing `assertSelf` guard) → re-submitting an already-`SUBMITTED`/`VERIFIED` token correctly rejected (`409`) → submitting with no `idDocument` correctly rejected (`400`) → invalid token correctly `404` → inviting with neither email nor phone correctly rejected (`400`) → re-inviting after `REJECTED` confirmed to create a genuinely new row (old row preserved, not overwritten).
- Every throwaway user, `Guarantor` row, notification, audit log, refresh token, OTP code, and R2 object created during testing was fully deleted afterward.

### Deployment prep — started on Render, pivoted to Railway (not in the original plan)

Requested directly: "we want to deploy on render." Rather than just writing docs against the
existing code, actually made the app deployable — this surfaced five real, independently-verified
bugs a production deploy would have hit (below), none of them Render-specific. Partway through,
the user changed target platforms: **"we will need to change our deployment to railway now, lets
remove everything that has to do with render."** `render.yaml` was deleted; `railway.json` and a
rewritten `DEPLOY.md` (Railway steps) replaced it. Everything below survived the pivot unchanged —
these are `Dockerfile`/application-level fixes, not platform config, so they apply the same way to
Railway (or anywhere else this ever gets deployed).

- **Redis connection was HOST/PORT-only** (`RedisService`, `BullModule.forRoot()` in
  `app.module.ts`) — fine for local Docker Compose, but every managed Redis provider (Railway's
  included) hands you a single connection string, not separate host/port. Added
  `src/redis/parse-redis-url.util.ts` (`REDIS_URL` → a plain `ioredis` options object, handling
  `rediss://` → TLS and embedded auth) and wired it into both call sites, with HOST/PORT kept as
  the local-dev fallback. Deliberately parses into an **options object**, not a live client passed
  straight to BullMQ — confirmed by reading `bullmq`'s own `RedisConnection` source that it only
  auto-applies the required `maxRetriesPerRequest: null` (needed for Worker blocking commands)
  when given options, not an already-constructed client; passing a live client would have silently
  broken every BullMQ worker (`NotificationsProcessor`, `ReportsProcessor`) the first time a real
  job ran.
- **No health-check endpoint existed at all** — `main.ts` already excluded `health` from the
  `/api/v1` prefix (a leftover from the original scaffold), but nothing implemented it. Added
  `HealthModule`/`HealthController` (`GET /health`) that actually round-trips both dependencies
  (`SELECT 1` against Postgres, `PING` against Redis) rather than just returning `200`
  unconditionally — every serious host's health check gates traffic cutover on this, so a
  fake-healthy endpoint would let a deploy with a broken DB/Redis connection go live anyway.
- **`prisma` (the CLI) was a devDependency** — the Dockerfile's production stage runs
  `npm ci --omit=dev`, so `prisma migrate deploy` wouldn't have been available in the production
  image to apply migrations on deploy. Moved it to a real dependency.
- **Dockerfile's `CMD` never ran migrations** — updated to
  `npx prisma migrate deploy && node dist/main`; `migrate deploy` is a safe no-op with nothing
  pending, so this works as a backstop regardless of whether the host platform's own
  pre-deploy-command feature is also used (Railway's `railway.json` `preDeployCommand` does, in
  parallel — see below).
- **No `.dockerignore` existed** — `docker build` was sending the entire repo (including
  `node_modules` and `.git`) as build context. Caught live: a local validation build hung for 10+
  minutes with zero progress output; `docker buildx du` showed real cache growth (build wasn't
  actually stuck, just glacially slow packaging an uncompressed `node_modules`), and a plain
  `du -sh node_modules` on this machine's filesystem itself timed out at 120s, confirming the real
  cause. Added `.dockerignore` mirroring `.gitignore`; the retried build proceeded normally
  afterward. This would have made every remote build (Railway's included) far slower than
  necessary, not just the local validation one.
- **Prisma couldn't detect OpenSSL on the `node:20-alpine` base** — caught live, mid-build:
  `prisma generate`'s own output warned `Prisma failed to detect the libssl/openssl version to
  use ... Defaulting to "openssl-1.1.x"`. Alpine ships the `libssl` runtime library but not the
  `openssl` CLI Prisma's detection script shells out to, so it silently guesses a query-engine
  binary target instead of reading the image's real OpenSSL 3.x. Fixed by adding
  `RUN apk add --no-cache openssl` to both Dockerfile stages (builder and production both run
  their own `prisma generate`), so detection reads the real version instead of guessing.
- **`npm ci` failed every dependency's engine check on `node:20-alpine`** — caught live in the
  build log: `npm warn EBADENGINE` for `firebase-admin` and its own dependency chain
  (`gcp-metadata`, `google-auth-library`, `google-logging-utils`), all declaring
  `engines.node >= 22`. Local dev this entire session ran on Node v24, so `node:20-alpine` in the
  Dockerfile was already an untested mismatch versus what FCM push notifications (wired up and
  live-verified earlier this session) were actually run against. Bumped both Dockerfile stages to
  `node:22-alpine`; added an explicit `"engines": { "node": ">=22" }` to `package.json` so this
  can't silently regress.
- **The container crashed on every boot — a real, would-have-failed-every-deploy bug** — caught by
  actually running the built image against real throwaway Postgres/Redis containers (not just
  trusting a successful `docker build`): `Error: Can't write to /app/node_modules/@prisma/engines
  please make sure you install "prisma" with the right permissions.` The Dockerfile switches to a
  non-root `USER kilo` for runtime (least-privilege, correct practice) — but `node_modules` was
  created earlier in the same stage while still root, and `prisma migrate deploy` writes into
  `node_modules/@prisma/engines` on every invocation, at container start. Root-owned directory,
  non-root process → instant crash, every single boot. Fixed with
  `RUN addgroup -S kilo && adduser -S kilo -G kilo && chown -R kilo:kilo /app` — ownership has to
  transfer *before* the `USER kilo` switch, not after.
- **Local Docker validation status at the time of the platform pivot**: the `docker build` itself
  succeeded cleanly post-fix (zero `EBADENGINE`, zero OpenSSL warnings, confirmed by grepping the
  full build log, not just the tail). A full boot-to-`/health` round-trip against real throwaway
  Postgres+Redis containers was in progress — the container was confirmed running post-chown-fix,
  but the final `GET /health` response was not yet captured before the user's Render→Railway pivot
  message arrived. **Re-run this same smoke test against the final `railway.json`/`Dockerfile`
  combination before trusting a live Railway deploy** — the fixes above are all independently
  verified, but the very last link (a real `/health: 200` from the fully-fixed image) hasn't been
  closed out yet.
- **Railway setup**: `railway.json` pins the build to `Dockerfile` (Railway defaults to Nixpacks
  auto-detection otherwise) and sets `healthcheckPath: /health` + `preDeployCommand: npx prisma
  migrate deploy` (Railway, unlike Render, doesn't restrict this field to paid plans — confirmed
  against Railway's own docs). Unlike Render's Blueprint model, Railway has no single-file
  multi-resource provisioning — Postgres and Redis get added as separate services via the
  dashboard, wired to the web service via Railway's `${{ServiceName.VAR}}` variable-reference
  syntax (`DATABASE_URL`/`DIRECT_URL` from Postgres, `REDIS_URL` from Redis — both confirmed as
  the actual exposed variable names against Railway's docs, not assumed). `DEPLOY.md` rewritten
  end-to-end for this flow.
- **Not yet done / can't be done from here**: no Railway API access or CLI session in this
  environment, so the actual account creation, GitHub connection, service setup, and first deploy
  are manual steps documented in `DEPLOY.md` for the user to run themselves — same constraint as
  Render before it.

---

## 3. Credentials & external setup checklist

Env var names only — never commit or paste actual secret values anywhere, including here.

### ✅ Configured (this environment)
| Var | Unlocks |
|---|---|
| `DATABASE_URL`, `DIRECT_URL` | Local Postgres via PgBouncer |
| `REDIS_HOST`, `REDIS_PORT` | Local Redis |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Auth — **dev-generated values, must be rotated to real production secrets before deploy** |
| `RESEND_API_KEY` | Real email sending is live (verification codes, staff invites) |
| `SUPERADMIN_PHONE`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` | Local dev bootstrap only (`npm run seed:superadmin`) — **do not reuse these values for a production seed** |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Object storage for KYC docs, proof-of-delivery photos — **live-verified**: `HeadBucket`/`PutObject`/`GetObject`/`DeleteObject` all succeeded against the real `kilo` bucket. Caught and fixed one real credential bug in this pass — `R2_ACCOUNT_ID` was originally a 53-char value with a `cfat_` prefix (not a real Cloudflare Account ID, which is exactly 32 hex chars), producing a bogus endpoint hostname that failed at the TLS handshake stage; corrected value now works |
| `TERMII_API_KEY` | Real SMS delivery for OTP codes and all `SmsService.sendMessage` uses (guarantor invites, delivery tracking links, etc.) — **live-verified**: key confirmed valid via Termii's `get-balance` endpoint (account "Digipeng"), and a real test SMS sent successfully through the app's exact send path. Caught and fixed one real bug in this pass — `sms.service.ts` hardcoded `from: 'Kilo'`, but the only sender ID active on this Termii account is `N-Alert`; real sends would have failed with an invalid-sender-ID error even though the key itself was valid. Code now sends with `from: 'N-Alert'`. **Known open gap**: a real test SMS was billed (₦5 deducted) and Termii returned `"Successfully Sent"`, but it never arrived on the test handset — the number is confirmed *not* DND-registered (checked live via Termii's `/api/check/dnd`), so the likely cause is `N-Alert` being a shared/generic sender ID rather than a dedicated transactional route; Termii's API has no endpoint to poll a message's real delivery status after the fact (only a dashboard webhook, not configured here) so this can't be confirmed further from the backend alone |
| `SENTRY_DSN` | Error tracking — **wired up in this pass** (previously wasn't read by any code at all) and **live-verified**: `@sentry/nestjs` installed, initialized in `src/instrument.ts` (imported first in `main.ts`, before any other module, per Sentry's own requirement), `SentryModule.forRoot()` + `SentryGlobalFilter` (as `APP_FILTER`) wired into `app.module.ts` so every unhandled exception is reported automatically. A temporary debug route was added, hit for a real `500`, confirmed in the app's own logs, then removed; separately confirmed with Sentry's debug-mode logging (`Captured error event` + `FLUSH RESULT: true`, no transport/auth errors) via a standalone script using the exact same DSN. **One real bug caught and fixed in this pass**: `@sentry/profiling-node` was initially installed alongside it for performance profiling, but it ships no prebuilt native binary for this machine's Node version and hung the entire app at boot (compiled fine, then never logged `Nest application successfully started` — confirmed via a hung child process). Removed `@sentry/profiling-node`; plain `@sentry/nestjs` error tracking doesn't need it and boots normally |
| `FCM_SERVICE_ACCOUNT_JSON` | Real push notifications via `FcmService` — **live-verified**: fetched a genuine OAuth access token from Google using the exact credential (`firebase-admin`'s `credential.getAccessToken()`), then a real round-trip send to FCM's `sendEachForMulticast` against a syntactically-valid dummy token returned `messaging/invalid-argument` (proves the send endpoint itself is reachable with correct permissions, not an auth/403 error). Caught and fixed one real bug in this pass — the value was pasted into `.env` as pretty-printed multi-line JSON, but `.env` is parsed line-by-line, so `FCM_SERVICE_ACCOUNT_JSON` only ever captured a literal `{` and `FcmService`'s `JSON.parse` was silently failing inside its own `try/catch`, falling back to the dev-mode console log with no visible error. Fixed by collapsing the value to a single minified-JSON line |

### ⚠️ Blank — needed before the feature works
| Var | Unlocks | Blocks |
|---|---|---|
| `PAYSTACK_SECRET_KEY` | Wallet top-up / withdrawal | `POST /wallet/topup`, `/wallet/withdraw` — currently return a clean `503 Paystack is not configured` |
| `PAYSTACK_WEBHOOK_SECRET` | *(currently unused — signature verification uses `PAYSTACK_SECRET_KEY` directly per Paystack's own scheme; keep this var for when webhook-specific secrets are split out)* | — |
| `GOOGLE_OAUTH_CLIENT_IDS` | Google sign-in (rider app) | `POST /auth/social/google*` — returns `503` until set. Comma-separated: needs every OAuth client ID the rider apps use (iOS/Android/web) |
| `APPLE_CLIENT_ID` | Sign in with Apple (rider app) | `POST /auth/social/apple*` — returns `503` until set. This is the Apple **Services ID**, from the Apple Developer portal |
| `EMAIL_FROM` | Sending from a real domain instead of Resend's shared `onboarding@resend.dev` | Nothing blocks *yet* — but Resend also restricts sending to **only your own account email** until a domain is verified at resend.com/domains. Real user-facing email needs this |
| `GOOGLE_MAPS_API_KEY` | Address autocomplete, real (not haversine-approximated) distance/ETA | `GET /places/autocomplete` returns `503` until set. Fare estimates/bookings still work without it (haversine fallback), just less accurately |
| `FLUTTERWAVE_SECRET_KEY` | Alternate payment gateway | Not integrated — Task 6 built Paystack only (deliberate scope choice, see plan.md Section 3's own recommendation). Revisit only if Flutterwave is actually wanted alongside/instead of Paystack |
| `SMILE_IDENTITY_PARTNER_ID`, `SMILE_IDENTITY_API_KEY` | NIN / facial verification | `POST /drivers/{id}/kyc/facial-verification`, `/kyc/government-id` — return a clean `503` until set. **`SmileIdentityService` itself is unverified against a live sandbox** — the job-submission contract was built from general API-shape knowledge, not confirmed against real docs/sandbox |

### Before going to production (not credentials, but adjacent)
- [ ] Real `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — rotate off the dev-generated values
- [ ] Real `SUPERADMIN_*` values for the production database — do not reuse dev credentials
- [ ] Verify a sending domain in Resend, set `EMAIL_FROM` to an address on it
- [ ] `npm audit` shows pre-existing moderate/high vulnerabilities in the `@nestjs/core` dependency chain (unrelated to anything built here) — fixing requires a breaking NestJS v10→v12 upgrade, deliberately not done yet
- [ ] `ThrottlerModule` in `app.module.ts` is commented as "Redis-backed" but is actually in-memory storage — rate limits won't be shared across multiple app instances until this is wired to Redis
- [ ] `test/` directory is empty — `npm run test:e2e` has no `jest-e2e.json` to run against; CI's test step is currently a no-op
- [ ] Dispatch's offer-expiry timer (`DispatchService.startDispatch`) is a plain in-process `setTimeout`, not a durable BullMQ job — a process restart mid-dispatch loses the scheduled expiry, leaving the ride stuck in `DISPATCHING` until something else touches it

---

## 4. Local dev bootstrap (for reference)

```bash
docker compose up -d postgres redis pgbouncer
npm install
npm run prisma:migrate:dev
npm run seed                    # permissions/roles + bootstrap SUPER_ADMIN + platform ledger accounts
npm run start:dev
```
