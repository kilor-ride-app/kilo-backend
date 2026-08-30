// Seeds the platform-level ledger accounts (ownerId: null). These are NOT
// lazily created by application code on first use — Account's
// @@unique([ownerId, type]) does NOT protect against duplicates here,
// because Postgres treats NULL as distinct from NULL in unique indexes, so
// two rows with ownerId=null and the same `type` would both be allowed.
// Creating them once, explicitly, up front avoids that race entirely.
//
// Usage: node scripts/seed-platform-accounts.js
const { PrismaClient } = require('@prisma/client');

const PLATFORM_ACCOUNT_TYPES = [
  'PLATFORM_REVENUE',
  'PLATFORM_GATEWAY_CLEARING',
  'PLATFORM_PROMO_LIABILITY',
  'PLATFORM_REFERRAL_PAYABLE',
];

async function main() {
  const prisma = new PrismaClient();

  for (const type of PLATFORM_ACCOUNT_TYPES) {
    const existing = await prisma.account.findFirst({ where: { ownerId: null, type } });
    if (existing) {
      console.log(`Already exists: ${type} (id: ${existing.id})`);
      continue;
    }
    const created = await prisma.account.create({ data: { ownerId: null, type } });
    console.log(`Created: ${type} (id: ${created.id})`);
  }

  await prisma.$disconnect();
}

main();
