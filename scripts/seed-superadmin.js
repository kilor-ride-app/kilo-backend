// Bootstraps the first SUPER_ADMIN account. Every other staff account is
// created through POST /admin/staff once one of these exists — there's no
// other way to get the very first admin into the system.
//
// Usage: SUPERADMIN_PHONE=+234... SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... node scripts/seed-superadmin.js
// (falls back to dev defaults below if unset — fine for local dev, never for a shared environment)
// Re-runnable: matches the existing record by phone and updates its email
// (and password, if SUPERADMIN_PASSWORD is set) rather than only setting
// fields on first create.
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');

async function main() {
  const phone = process.env.SUPERADMIN_PHONE ?? '+2348000000000';
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD ?? 'change-me-immediately';

  if (!process.env.SUPERADMIN_PASSWORD && process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a default super-admin password in production — set SUPERADMIN_PASSWORD');
  }

  const prisma = new PrismaClient();
  const passwordHash = await argon2.hash(password);
  const user = await prisma.user.upsert({
    where: { phone },
    update: {
      ...(email ? { email } : {}),
      ...(process.env.SUPERADMIN_PASSWORD ? { passwordHash } : {}),
    },
    create: {
      firstName: 'Root',
      lastName: 'Admin',
      phone,
      email,
      passwordHash,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  });
  console.log(`Super admin ready: ${user.phone}${user.email ? ` / ${user.email}` : ''} (id: ${user.id})`);
  await prisma.$disconnect();
}

main();
