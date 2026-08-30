# ── Build stage ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ── Production stage ─────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

# Non-root user — least-privilege inside the container too
RUN addgroup -S kilo && adduser -S kilo -G kilo
USER kilo

EXPOSE 3000

# Applies any pending migrations before every boot — `migrate deploy` is a
# safe no-op when there's nothing pending, so this works whether or not the
# host platform's own pre-deploy-command feature is available/used instead.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
