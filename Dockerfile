# node:22, not 20 — `firebase-admin` and its own dependency chain
# (gcp-metadata, google-auth-library, google-logging-utils) declare
# `engines.node >= 22` (confirmed live: `npm ci` on node:20 printed
# `npm warn EBADENGINE` for all four). Local dev this session ran on
# Node v24, so 20 was already an untested mismatch versus what was
# actually verified working.
# ── Build stage ──────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Alpine ships libssl but not the `openssl` CLI Prisma's engine-detection
# script shells out to — without it, `prisma generate` can't tell which
# OpenSSL version is actually present and silently guesses (confirmed live:
# "Prisma failed to detect the libssl/openssl version ... Defaulting to
# openssl-1.1.x", which risks baking in a query-engine binary that doesn't
# match this image's real OpenSSL 3.x).
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ── Production stage ─────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# Same reasoning as the builder stage — this stage runs its own
# `prisma generate` (see below), so it needs the same fix.
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

# Non-root user — least-privilege inside the container too. Ownership has
# to transfer *before* switching: everything above was created as root, and
# `prisma migrate deploy` (run at container start, below) writes into
# node_modules/@prisma/engines every invocation — confirmed live, this
# crashed the container outright ("Can't write to
# /app/node_modules/@prisma/engines ... right permissions") when `kilo`
# didn't own it yet.
RUN addgroup -S kilo && adduser -S kilo -G kilo && chown -R kilo:kilo /app
USER kilo

EXPOSE 3000

# Applies any pending migrations before every boot — `migrate deploy` is a
# safe no-op when there's nothing pending, so this works whether or not the
# host platform's own pre-deploy-command feature is available/used instead.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
