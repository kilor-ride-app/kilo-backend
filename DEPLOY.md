# Deploying to Render

This repo deploys as a [Render Blueprint](https://render.com/docs/blueprint-spec) — `render.yaml`
at the repo root defines all three resources (web service, Postgres, Redis) as one unit, so
Render creates and wires them together automatically instead of clicking through three separate
dashboard flows.

Plans are currently set to Render's **free** tier — no card-required cost to try the deploy
pipeline itself. Know the real tradeoffs that come with that before relying on it for more than a
demo, though: the web service spins down after 15 min idle (drops any open WebSocket connection —
this app's live ride-offer dispatch and live tracking — and delays the next request by ~1 min
while it cold-starts), BullMQ's scheduled/repeatable jobs don't fire while asleep, free Postgres
auto-deletes 30 days after creation, and free Redis has no data persistence across restarts. The
comment block at the top of `render.yaml` explains each of these and exactly what to change
(`plan: free` → a paid tier per resource, plus re-adding `preDeployCommand`) once any of that
starts to matter.

---

## 1. Push this repo to GitHub

Render builds from a GitHub (or GitLab) repo, so everything has to be committed and pushed first.

```bash
git add -A
git commit -m "Prepare for Render deployment"
git push
```

If you're not sure what's changed since the last push, run `git status` first.

---

## 2. Create the Blueprint on Render

1. Sign in at [dashboard.render.com](https://dashboard.render.com) (or create an account —
   GitHub sign-in is the fastest path since you'll need to connect the repo anyway).
2. **New +** → **Blueprint**.
3. Connect your GitHub account if you haven't already, then select this repo.
4. Render reads `render.yaml` and shows you the three resources it's about to create:
   `kilo-postgres` (database), `kilo-redis` (Key Value), `kilo-backend` (web service).
5. Click through — Render will prompt you to fill in a value for every env var marked
   `sync: false` in `render.yaml` (nothing secret is stored in the file itself, by design; the
   `render.yaml` header comment says the same). See the table below for what each one needs and
   where to get it.
6. Confirm and create. Render starts building immediately.

### Env vars you'll be prompted for

Values already live-verified working in local dev are noted — for those, just copy the same
value from your local `.env`. See `PROGRESS.md` Section 3 for the full story on each credential
(what's been tested, known gaps, how to obtain new ones).

| Var | What to enter |
|---|---|
| `CORS_ORIGINS` | Comma-separated list of the real frontend origins that will call this API (e.g. `https://app.kilo.ng,https://admin.kilo.ng`) — **not** `localhost` |
| `ADMIN_APP_URL` | Base URL of the deployed admin frontend (staff-invite links point here) |
| `BUSINESS_APP_URL` | Base URL of the deployed business-portal frontend |
| `GUARANTOR_APP_URL` | Base URL of wherever the guarantor public-submission form is hosted |
| `SUPERADMIN_PHONE`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` | **New, real** production values — do not reuse the local dev bootstrap credentials. Used once, in Step 4 below |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Same values as local `.env` — live-verified this session |
| `TERMII_API_KEY` | Same value as local `.env` — live-verified this session (note: see `PROGRESS.md` for an open sender-ID delivery gap) |
| `RESEND_API_KEY` | Same value as local `.env` |
| `EMAIL_FROM` | A verified-domain address (see resend.com/domains) — until this is set, email sending stays limited to Resend's sandbox restrictions, same as local dev |
| `FCM_SERVICE_ACCOUNT_JSON` | The **minified, single-line** JSON from local `.env` — paste it exactly as one line. (This bit us once already this session in the local `.env` file when it was pasted pretty-printed across multiple lines; Render's dashboard text field handles multi-line values fine, but keep it single-line anyway for consistency with what's already been tested) |
| `SENTRY_DSN` | Same value as local `.env` — wired up and live-verified this session |
| `SMILE_IDENTITY_PARTNER_ID`, `SMILE_IDENTITY_API_KEY` | Leave blank unless you have real Smile Identity sandbox/production credentials — facial/government-ID verification returns a clean `503` until set |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_WEBHOOK_SECRET` | Leave blank unless you have a real Paystack account — wallet top-up/withdraw returns a clean `503` until set |
| `FLUTTERWAVE_SECRET_KEY` | Leave blank — not integrated (deliberate scope choice, see `PROGRESS.md`) |
| `GOOGLE_OAUTH_CLIENT_IDS` | Leave blank unless Google sign-in is ready — comma-separated OAuth client IDs |
| `APPLE_CLIENT_ID` | Leave blank unless Sign in with Apple is ready — the Apple **Services ID** |
| `GOOGLE_MAPS_API_KEY` | Leave blank to keep the haversine-approximated fallback for distance/ETA, or set for real routing |

Everything else (`DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `NODE_ENV`, `ENABLE_SWAGGER`) is wired up automatically by `render.yaml` —
the two JWT secrets are freshly randomly generated by Render itself, not copied from local dev.

---

## 3. Wait for the first deploy

Render will:
1. Provision `kilo-postgres` and `kilo-redis`.
2. Build `kilo-backend` from the `Dockerfile` (multi-stage: installs deps, runs `prisma generate`,
   compiles TypeScript, then builds a lean production image).
3. Run `npx prisma migrate deploy` as part of the container's own start command (the Dockerfile's
   `CMD`) — this applies every migration in `prisma/migrations/`, creating all tables fresh
   against the new empty database. (On a paid plan, `render.yaml` can also run this via
   `preDeployCommand` instead, before traffic cuts over — free plans don't support that field, so
   it's left out for now; the Dockerfile's own migration step covers it either way.)
4. Start the app and poll `GET /health` until it responds `200 {"status":"ok"}` (checks both
   Postgres and Redis are actually reachable, not just that the process is up) before marking the
   deploy live.

Watch the build/deploy logs in the Render dashboard. A first deploy typically takes a few minutes.

---

## 4. Seed the database once

The very first `SUPER_ADMIN` account and the permissions/roles table have to be seeded manually —
there's no other way to get the first admin into a fresh database (every other staff account is
created through `POST /admin/staff` once one exists).

In the Render dashboard, open `kilo-backend` → **Shell**, then run:

```bash
npm run seed
```

This runs, in order: `seed:permissions` (permission/role definitions), `seed:superadmin` (creates
the `SUPER_ADMIN` from the `SUPERADMIN_*` env vars you set in Step 2), `seed:platform-accounts`
(the internal ledger accounts the wallet system debits/credits against — required before any
ride, delivery, or Kilowatt payment will work).

This is safe to re-run — `seed-superadmin.js` upserts by phone, and the other two scripts are
idempotent as well.

---

## 5. Verify the deploy

```bash
curl https://<your-service>.onrender.com/health
# {"status":"ok"}

curl https://<your-service>.onrender.com/docs
# Swagger UI, if ENABLE_SWAGGER wasn't flipped to "false"
```

Log in as the super admin you just seeded (`POST /api/v1/auth/login`) and confirm you get back a
real access token — that exercises the full path (Postgres write on login, JWT signing) in one
call.

---

## 6. After the first deploy

- **Auto-deploy**: by default Render redeploys `kilo-backend` automatically on every push to the
  branch you connected (`main`). Turn this off in the service's Settings if you'd rather deploy
  manually.
- **Custom domain**: Settings → Custom Domains, once you're ready to point a real domain at it.
- **Logs & metrics**: the Render dashboard's Logs tab streams the same structured NestJS logs
  you've seen locally all session; Sentry (already wired up) catches unhandled exceptions
  separately.
- **Scaling**: `kilo-backend`'s plan (`0.5c-512mb` by default) can be bumped from the Settings tab
  as real traffic needs it — no code or `render.yaml` change required for a simple resize.
- **Rotate secrets**: the `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` Render generated in Step 2 are
  real production secrets now — treat them accordingly (rotating either one invalidates every
  existing session/refresh token).
