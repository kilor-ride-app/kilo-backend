// Seeds the baseline Permission set and a few starter departmental Roles
// (manager, finance, logistics, support). Permissions are code-defined —
// this list should grow alongside the @RequirePermissions() checks added
// as each domain module lands (KYC, pricing, logistics, ...), not ahead of
// them. Roles are just named bundles of these and are freely editable
// afterwards via POST /admin/roles.
//
// Usage: node scripts/seed-permissions.js
const { PrismaClient } = require('@prisma/client');

const PERMISSIONS = [
  { key: 'staff.invite', description: 'Invite new admin/support staff' },
  { key: 'staff.manage', description: 'List staff, revoke pending invites' },
  { key: 'kyc.approve', description: 'Approve driver KYC submissions' },
  { key: 'kyc.reject', description: 'Reject driver KYC submissions' },
  { key: 'wallet.commission.edit', description: 'Edit commission/tariff configuration' },
  { key: 'wallet.reconcile', description: 'Perform manual ledger reconciliation' },
  { key: 'finance.transactions.view', description: 'View all platform transactions' },
  { key: 'logistics.manage', description: 'Manage package/freight operations' },
  { key: 'support.tickets.manage', description: 'Manage support tickets and escalations' },
  { key: 'service-areas.manage', description: 'Create/edit/remove service areas' },
  { key: 'rides.view', description: 'View ride records and cancellation reports' },
  { key: 'notifications.send', description: 'Send broadcast/targeted/scheduled notifications' },
  { key: 'admin.users.manage', description: 'Suspend/activate rider and driver accounts' },
  { key: 'admin.config.edit', description: 'Edit platform config (e.g. cash-ride commission cap)' },
  { key: 'admin.dashboard.view', description: 'View admin dashboard summary and live driver map' },
  { key: 'admin.audit.view', description: 'View the admin audit log' },
  { key: 'business.manage', description: 'List business accounts, set credit limits' },
  { key: 'kilowatt.manage', description: 'Manage charging stations, battery-swap reservations, solar leads' },
  { key: 'reports.view', description: 'View and export admin reports' },
  { key: 'promos.manage', description: 'Create/edit/remove promo codes, view redemption stats' },
  { key: 'referrals.manage', description: 'View referral program performance, process payouts' },
  { key: 'fleet-partners.manage', description: 'Onboard fleet partners, attach drivers, view earnings' },
  { key: 'partner-offers.manage', description: 'Create/edit partner offer listings, view claim stats' },
];

const ROLES = [
  {
    name: 'manager',
    description: 'Operational oversight — staff, KYC approval, service areas',
    permissionKeys: [
      'staff.invite',
      'staff.manage',
      'kyc.approve',
      'kyc.reject',
      'service-areas.manage',
      'rides.view',
      'notifications.send',
      'admin.users.manage',
      'admin.config.edit',
      'admin.dashboard.view',
      'admin.audit.view',
      'kilowatt.manage',
      'reports.view',
      'promos.manage',
      'referrals.manage',
      'fleet-partners.manage',
      'partner-offers.manage',
    ],
  },
  {
    name: 'finance',
    description: 'Commission config, reconciliation, transaction visibility',
    permissionKeys: [
      'finance.transactions.view',
      'wallet.commission.edit',
      'wallet.reconcile',
      'business.manage',
      'reports.view',
      'referrals.manage',
    ],
  },
  {
    name: 'logistics',
    description: 'Package/freight operations',
    permissionKeys: ['logistics.manage'],
  },
  {
    name: 'support',
    description: 'Ticket handling and escalation',
    permissionKeys: ['support.tickets.manage'],
  },
];

async function main() {
  const prisma = new PrismaClient();

  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { description: p.description },
      create: p,
    });
  }

  for (const r of ROLES) {
    await prisma.role.upsert({
      where: { name: r.name },
      update: {
        description: r.description,
        permissions: { set: r.permissionKeys.map((key) => ({ key })) },
      },
      create: {
        name: r.name,
        description: r.description,
        permissions: { connect: r.permissionKeys.map((key) => ({ key })) },
      },
    });
  }

  console.log(`Seeded ${PERMISSIONS.length} permissions and ${ROLES.length} roles.`);
  await prisma.$disconnect();
}

main();
