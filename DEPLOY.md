# Deploying to Railway

This repo deploys to [Railway](https://railway.com) from the same `Dockerfile` used for local
Docker builds. `railway.json` at the repo root pins the build to that Dockerfile (rather than
Railway's default Nixpacks auto-detection) and configures the health check Railway uses to decide
whether a deploy is actually live.

Unlike some platforms, Railway doesn't provision multiple resources (web service + Postgres +
Redis) from one committed config file — each gets added as its own service inside a Railway
**project**, wired together with variable references. That's what Steps 2–3 below do.

Railway's Postgres and Redis are plain Docker containers running the official images inside your
project (Railway calls these "unmanaged") — not a separately-managed database product. Treat
backups accordingly: Railway supports volume snapshots, but there's no separate managed-backup
tier to fall back on.

---

## 1. Push this repo to GitHub

Railway builds from a GitHub repo, so everything has to be committed and pushed first.

```bash
git add -A
git commit -m "Prepare for Railway deployment"
git push
```

If you're not sure what's changed since the last push, run `git status` first.

---

## 2. Create the project and add Postgres + Redis

1. Sign in at [railway.com](https://railway.com) (GitHub sign-in is fastest, since you'll connect
   the repo anyway). Railway's free "Free" plan usage is tiny (~$1/mo of credit) — realistically,
   running Postgres + Redis + a web service continuously will need billing set up (the Hobby plan,
   $5/mo) before too long. Add a card when Railway prompts for it; there's no way around this for
   an always-on backend the way there sometimes is on other platforms' free tiers.
2. **New Project** → **Deploy from GitHub repo** → select this repo. Railway creates the project
   and a first service from it, but don't let it deploy yet — add the databases first so their
   variables exist when you wire up the web service's env vars in Step 4.
3. In the project canvas, **+ New** → **Database** → **Add PostgreSQL**.
4. **+ New** → **Database** → **Add Redis**.

---

## 3. Configure the web service

Click into the service Railway created from your repo (not the Postgres/Redis ones).

1. **Settings** → confirm **Builder** is set to use `railway.json` / Dockerfile (it should
   auto-detect `railway.json` and switch to Dockerfile builds; if it shows Nixpacks, change it to
   Dockerfile manually).
2. **Settings** → **Networking** → **Generate Domain** to get a public `*.up.railway.app` URL (or
   attach a custom domain later).
3. **Variables** tab — add every var below. Railway lets you paste a whole block of
   `KEY=VALUE` lines at once (there's a "Raw Editor" toggle), which is faster than one at a time.

### Env vars to set

The Postgres/Redis ones use Railway's variable-reference syntax (`${{ServiceName.VAR}}`) —
replace `Postgres`/`Redis` with whatever you actually named those two services if you renamed them
from the defaults.

| Var | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `DIRECT_URL` | `${{Postgres.DATABASE_URL}}` (same value — Railway's Postgres has no separate pooler/direct distinction) |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `NODE_ENV` | `production` |
| `ENABLE_SWAGGER` | `false` (flip to `true` if you want `/docs` reachable in production) |
| `JWT_ACCESS_SECRET` | Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `JWT_ACCESS_EXPIRES_IN` | `15m` |
| `JWT_REFRESH_SECRET` | Generate another one the same way — **must be a different value from `JWT_ACCESS_SECRET`** |
| `JWT_REFRESH_EXPIRES_IN` | `30d` |

Then the real secrets and environment-specific URLs — values already live-verified working in
local dev are noted; for those, copy the same value from your local `.env`. See `PROGRESS.md`
Section 3 for the full story on each credential (what's been tested, known gaps, how to obtain
new ones).

| Var | What to enter |
|---|---|
| `CORS_ORIGINS` | Comma-separated list of the real frontend origins that will call this API (e.g. `https://app.kilo.ng,https://admin.kilo.ng`) — **not** `localhost` |
| `ADMIN_APP_URL` | Base URL of the deployed admin frontend (staff-invite links point here) |
| `BUSINESS_APP_URL` | Base URL of the deployed business-portal frontend |
| `GUARANTOR_APP_URL` | Base URL of wherever the guarantor public-submission form is hosted |
| `SUPERADMIN_PHONE`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` | **New, real** production values — do not reuse the local dev bootstrap credentials. Used once, in Step 5 below |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Same values as local `.env` — live-verified this session |
| `TERMII_API_KEY` | Same value as local `.env` — live-verified this session (note: see `PROGRESS.md` for an open sender-ID delivery gap) |
| `RESEND_API_KEY` | Same value as local `.env` |
| `EMAIL_FROM` | A verified-domain address (see resend.com/domains) — until this is set, email sending stays limited to Resend's sandbox restrictions, same as local dev. **Staff invites specifically**: with an unverified sender the invite email fails, and the API now returns `503` + rolls the invite row back (so the admin can retry); `POST /admin/staff/invites/:id/resend` also exists. Verify the sender domain (SPF/DKIM/DMARC in Resend) to make invites deliver. |
| `R2_PUBLIC_BASE_URL` | Optional. Public bucket URL or CDN domain for the R2 bucket — when set, uploaded admin avatars are stored as stable public URLs; otherwise a 7-day signed URL is used as a fallback |
| `FCM_SERVICE_ACCOUNT_JSON` | The **minified, single-line** JSON from local `.env` — paste it exactly as one line (this bit us once already this session when it was pasted pretty-printed across multiple lines in a `.env` file; keep it single-line here too) |
| `SENTRY_DSN` | Same value as local `.env` — wired up and live-verified this session |
| `SMILE_IDENTITY_PARTNER_ID`, `SMILE_IDENTITY_API_KEY` | Leave blank unless you have real Smile Identity sandbox/production credentials — facial/government-ID verification returns a clean `503` until set |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_WEBHOOK_SECRET` | Leave blank unless you have a real Paystack account — wallet top-up/withdraw returns a clean `503` until set |
| `FLUTTERWAVE_SECRET_KEY` | Leave blank — not integrated (deliberate scope choice, see `PROGRESS.md`) |
| `GOOGLE_OAUTH_CLIENT_IDS` | Leave blank unless Google sign-in is ready — comma-separated OAuth client IDs |
| `APPLE_CLIENT_ID` | Leave blank unless Sign in with Apple is ready — the Apple **Services ID** |
| `GOOGLE_MAPS_API_KEY` | Leave blank to keep the haversine-approximated fallback for distance/ETA, or set for real routing |

---

## 4. Deploy

Trigger the first deploy from the service's **Deployments** tab (**Deploy** button), or just push
another commit — Railway auto-deploys on push to the connected branch by default.

Railway will:
1. Build `kilo-backend` from the `Dockerfile` (multi-stage: installs deps, runs `prisma generate`,
   compiles TypeScript, then builds a lean production image).
2. Run `npx prisma migrate deploy` — both via `railway.json`'s `preDeployCommand` (before traffic
   cuts over) and again inside the container's own start command as a safety net. Both are safe to
   run back-to-back: `migrate deploy` is a no-op with nothing pending.
3. Start the app and poll `GET /health` until it responds `200 {"status":"ok"}` (checks both
   Postgres and Redis are actually reachable, not just that the process is up) before marking the
   deploy live.

Watch the build/deploy logs in the Railway dashboard. A first deploy typically takes a few minutes.

---

## 5. Seed the database once

The very first `SUPER_ADMIN` account and the permissions/roles table have to be seeded manually —
there's no other way to get the first admin into a fresh database (every other staff account is
created through `POST /admin/staff` once one exists).

Open the web service in the Railway dashboard → the three-dot menu on a running deployment (or the
**Shell** tab, if enabled for your plan) → run:

```bash
npm run seed
```

This runs, in order: `seed:permissions` (permission/role definitions), `seed:superadmin` (creates
the `SUPER_ADMIN` from the `SUPERADMIN_*` env vars you set in Step 3), `seed:platform-accounts`
(the internal ledger accounts the wallet system debits/credits against — required before any
ride, delivery, or Kilowatt payment will work).

This is safe to re-run — `seed-superadmin.js` upserts by phone, and the other two scripts are
idempotent as well.

If your plan doesn't expose a dashboard shell, use the [Railway CLI](https://docs.railway.com/guides/cli)
instead: `railway run npm run seed` (or `railway ssh` then `npm run seed`) from this repo locally,
linked to the project (`railway link`).

---

## 6. Verify the deploy

```bash
curl https://<your-service>.up.railway.app/health
# {"status":"ok"}

curl https://<your-service>.up.railway.app/docs
# Swagger UI, if ENABLE_SWAGGER wasn't set to "false"
```

Log in as the super admin you just seeded (`POST /api/v1/auth/login`) and confirm you get back a
real access token — that exercises the full path (Postgres write on login, JWT signing) in one
call.

---

## 7. After the first deploy

- **Auto-deploy**: by default Railway redeploys the web service automatically on every push to the
  connected branch. Turn this off in the service's Settings if you'd rather deploy manually.
- **Custom domain**: Settings → Networking → Custom Domain, once you're ready to point a real
  domain at it.
- **Logs & metrics**: the Railway dashboard's Observability tab streams the same structured NestJS
  logs you've seen locally all session; Sentry (already wired up) catches unhandled exceptions
  separately.
- **Scaling**: adjust CPU/RAM limits and replica count from the service's Settings → Resources tab
  — no code or `railway.json` change required for a simple resize.
- **Rotate secrets**: `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` are real production secrets once
  set — treat them accordingly (rotating either one invalidates every existing session/refresh
  token).
