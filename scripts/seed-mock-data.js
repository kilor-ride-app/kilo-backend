/*
 * Temporary mock data for admin-panel testing.
 *
 * Seeds ~20+ rows into every admin-relevant table (users, businesses,
 * service areas, tariffs, rides, deliveries, wallet ledger, KYC, support,
 * kilowatt, promos, referrals, partnerships, notifications, audit log, ...).
 *
 * WHERE IT WRITES: whatever DATABASE_URL points at. There is no localhost
 * guard — you pick the target. It refuses to run without --yes so a bare
 * `node scripts/seed-mock-data.js` can't silently write to prod.
 *
 * Usage:
 *   node scripts/seed-mock-data.js --yes           # clean previous seed rows, then reseed
 *   node scripts/seed-mock-data.js --yes --reset   # only clean previous seed rows
 *
 * RE-RUN SAFETY: every row created here carries a marker —
 *   - users / businesses / invites / staff / fleet / reports:  email or
 *     contactEmail ends with  @seed.kilo.test
 *   - service areas / stations / campaigns:  name/title starts with  [SEED]
 *   - promos / referral codes:  code starts with  SEED
 *   - wallet transactions:  reference starts with  seed:
 *   - device tokens / bank refs:  value starts with  seed-
 *   - commission rules:  vehicleType starts with  SEED-
 *   - partner offers:  partnerName ends with  (seed)
 * Re-running deletes exactly those rows (in FK-safe order) and recreates a
 * fresh set, so counts stay stable and nothing real is touched. The wallet
 * ledger balances against a dedicated seeded suspense account (ownerId
 * "seed-treasury-account"), never the real platform accounts, so reseeding
 * causes no balance drift on live data.
 *
 * All seeded users share the password:  Passw0rd!seed
 * Seeded user emails are  seed.user.<n>@seed.kilo.test   (n starts at 100)
 */
const crypto = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');
const argon2 = require('argon2');
const { faker } = require('@faker-js/faker');

faker.seed(20240831);

const N = 20; // baseline rows per table
const SEED_PASSWORD = 'Passw0rd!seed';
const SD = '@seed.kilo.test'; // seeded-email suffix
const SEED_TREASURY_OWNER = 'seed-treasury-account';

const prisma = new PrismaClient();

// ── cleanup (marker-based, child-before-parent) ─────────────────────────
async function cleanup() {
  console.log('Cleaning previous seed data…');
  const seededUsers = await prisma.user.findMany({
    where: { email: { endsWith: SD } },
    select: { id: true },
  });
  const seededUserIds = seededUsers.map((u) => u.id);

  const byRiderEmail = { rider: { email: { endsWith: SD } } };
  const bySenderEmail = { sender: { email: { endsWith: SD } } };
  const byDriverEmail = { driver: { email: { endsWith: SD } } };
  const byUserEmail = { user: { email: { endsWith: SD } } };

  const steps = [
    ['ledgerEntry', { transaction: { reference: { startsWith: 'seed:' } } }],
    ['transaction', { reference: { startsWith: 'seed:' } }],
    ['rideRating', { ride: byRiderEmail }],
    ['rideOffer', { ride: byRiderEmail }],
    ['deliveryOffer', { delivery: bySenderEmail }],
    ['deliveryStop', { delivery: bySenderEmail }],
    ['invoice', { business: { contactEmail: { endsWith: SD } } }],
    ['ride', byRiderEmail],
    ['delivery', bySenderEmail],
    ['withdrawalRequest', { bankAccountId: { startsWith: 'seed-bank-' } }],
    ['account', { ownerId: { in: [...seededUserIds, SEED_TREASURY_OWNER] } }],
    ['kycDocument', byDriverEmail],
    ['kycVerification', byDriverEmail],
    ['guarantor', byDriverEmail],
    ['deviceToken', { token: { startsWith: 'seed-' } }],
    ['staffInvite', { email: { endsWith: SD } }],
    ['businessTeamInvite', { email: { endsWith: SD } }],
    ['notification', byUserEmail],
    ['notificationCampaign', { title: { startsWith: '[SEED] ' } }],
    ['auditLog', { actorId: { in: seededUserIds } }],
    ['scheduledReport', { recipientEmail: { endsWith: SD } }],
    ['referralRedemption', { referrer: { email: { endsWith: SD } } }],
    ['referralCode', byUserEmail],
    ['fleetPartnerDriver', byDriverEmail],
    ['fleetPartner', { contactEmail: { endsWith: SD } }],
    ['partnerOfferClaim', byUserEmail],
    ['partnerOffer', { partnerName: { endsWith: '(seed)' } }],
    ['promoRedemption', { promo: { code: { startsWith: 'SEED' } } }],
    ['promo', { code: { startsWith: 'SEED' } }],
    ['batterySwapReservation', { station: { name: { startsWith: '[SEED] ' } } }],
    ['batterySwapStation', { name: { startsWith: '[SEED] ' } }],
    ['chargingStation', { name: { startsWith: '[SEED] ' } }],
    ['supportTicketMessage', { ticket: byUserEmail }],
    ['supportTicket', byUserEmail],
    ['solarAssessment', byUserEmail],
    ['driverStatus', byUserEmail],
    ['tariff', { serviceArea: { name: { startsWith: '[SEED] ' } } }],
    ['commissionRule', { vehicleType: { startsWith: 'SEED-' } }],
    ['serviceArea', { name: { startsWith: '[SEED] ' } }],
  ];

  for (const [model, where] of steps) {
    const res = await prisma[model].deleteMany({ where });
    if (res.count) console.log(`  - ${model}: ${res.count}`);
  }

  // User.businessId FK → unlink seeded users before removing businesses
  await prisma.user.updateMany({
    where: { email: { endsWith: SD } },
    data: { businessId: null },
  });
  const biz = await prisma.business.deleteMany({ where: { contactEmail: { endsWith: SD } } });
  if (biz.count) console.log(`  - business: ${biz.count}`);
  const usr = await prisma.user.deleteMany({ where: { email: { endsWith: SD } } });
  if (usr.count) console.log(`  - user: ${usr.count}`);
  console.log('Cleanup done.\n');
}

// ── helpers ─────────────────────────────────────────────────────────────
const range = (n) => Array.from({ length: n }, (_, i) => i);
const pick = (arr, i) => arr[i % arr.length];
const rand = (min, max) => faker.number.int({ min, max });
const money = (min, max) => faker.number.float({ min, max, fractionDigits: 2 });
const tokenHex = () => crypto.randomBytes(32).toString('hex');
const uuid = () => crypto.randomUUID();
const lagosLat = () => faker.location.latitude({ min: 6.4, max: 6.65 });
const lagosLng = () => faker.location.longitude({ min: 3.28, max: 3.55 });
const soon = (days) => faker.date.soon({ days });
const past = (days) => faker.date.recent({ days });

const RIDE_VEHICLES = ['ECONOMY', 'COMFORT', 'XL', 'BIKE', 'KEKE'];
const CARGO_VEHICLES = ['BIKE', 'VAN', 'TRUCK'];

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--yes')) {
    console.error(
      'Refusing to run without --yes.\n' +
        'This writes to whatever DATABASE_URL points at (possibly production).\n' +
        '  node scripts/seed-mock-data.js --yes\n' +
        '  node scripts/seed-mock-data.js --yes --reset   (clean only)',
    );
    process.exit(1);
  }

  const target = (process.env.DATABASE_URL || '(DATABASE_URL not set)').replace(/:[^:@/]*@/, ':***@');
  console.log(`Target: ${target}\n`);

  await cleanup();

  if (args.includes('--reset')) {
    console.log('--reset given: cleaned only, not reseeding.');
    await prisma.$disconnect();
    return;
  }

  const passwordHash = await argon2.hash(SEED_PASSWORD);
  const created = {};
  const note = (model, n) => (created[model] = (created[model] || 0) + n);

  // ── Users ─────────────────────────────────────────────────────────────
  console.log('Seeding users…');
  async function makeUsers(count, role, status, startIndex) {
    const out = [];
    for (let k = 0; k < count; k++) {
      const n = startIndex + k;
      out.push(
        await prisma.user.create({
          data: {
            firstName: faker.person.firstName(),
            lastName: faker.person.lastName(),
            email: `seed.user.${n}${SD}`,
            emailVerifiedAt: k % 3 === 0 ? past(30) : null,
            phone: `+23481${String(n).padStart(8, '0')}`,
            passwordHash,
            role,
            status,
            profilePhotoUrl: k % 2 === 0 ? faker.image.avatar() : null,
          },
        }),
      );
    }
    return out;
  }

  const riders = await makeUsers(N, 'RIDER', 'ACTIVE', 100);
  const drivers = await makeUsers(N, 'DRIVER', 'ACTIVE', 200);
  const bizAdmins = await makeUsers(N, 'BUSINESS_ADMIN', 'ACTIVE', 300);
  const staff = [
    ...(await makeUsers(5, 'SUPER_ADMIN', 'ACTIVE', 400)),
    ...(await makeUsers(8, 'ADMIN', 'ACTIVE', 405)),
    ...(await makeUsers(7, 'SUPPORT_AGENT', 'ACTIVE', 413)),
  ];
  const misc = [
    ...(await makeUsers(4, 'RIDER', 'SUSPENDED', 500)),
    ...(await makeUsers(4, 'DRIVER', 'PENDING_VERIFICATION', 504)),
  ];
  const allUsers = [...riders, ...drivers, ...bizAdmins, ...staff, ...misc];
  const admin = staff[0];
  note('user', allUsers.length);

  // ── Businesses ────────────────────────────────────────────────────────
  console.log('Seeding businesses…');
  const businesses = [];
  for (const i of range(N)) {
    businesses.push(
      await prisma.business.create({
        data: {
          name: `${faker.company.name()} (seed)`,
          registrationNumber: `RC${rand(100000, 999999)}`,
          contactEmail: `seed.biz.${i}${SD}`,
          contactPhone: `+23470${String(i).padStart(8, '0')}`,
          creditLimit: money(50000, 2000000),
        },
      }),
    );
  }
  note('business', businesses.length);
  for (const i of range(N)) {
    await prisma.user.update({
      where: { id: bizAdmins[i].id },
      data: { businessId: businesses[i].id },
    });
  }

  // ── Service areas ─────────────────────────────────────────────────────
  console.log('Seeding service areas…');
  const areas = [];
  for (const i of range(N)) {
    const cLat = 6.4 + i * 0.01;
    const cLng = 3.3 + i * 0.01;
    const d = 0.02;
    areas.push(
      await prisma.serviceArea.create({
        data: {
          name: `[SEED] ${faker.location.city()} Zone ${i + 1}`,
          polygon: {
            type: 'Polygon',
            coordinates: [
              [
                [cLng - d, cLat - d],
                [cLng + d, cLat - d],
                [cLng + d, cLat + d],
                [cLng - d, cLat + d],
                [cLng - d, cLat - d],
              ],
            ],
          },
          isActive: i % 5 !== 0,
        },
      }),
    );
  }
  note('serviceArea', areas.length);

  // ── Tariffs ───────────────────────────────────────────────────────────
  console.log('Seeding tariffs…');
  for (const i of range(N)) {
    await prisma.tariff.create({
      data: {
        vehicleType: pick(RIDE_VEHICLES, i),
        serviceAreaId: areas[i].id,
        baseFare: money(300, 1200),
        perKmRate: money(80, 250),
        perMinuteRate: money(10, 40),
        minimumFare: money(500, 1500),
        cancellationFee: money(200, 600),
        currency: 'NGN',
        isActive: true,
      },
    });
  }
  note('tariff', N);

  // ── Commission rules ──────────────────────────────────────────────────
  console.log('Seeding commission rules…');
  const svcTypes = ['RIDE', 'DELIVERY', 'KILOWATT'];
  for (const i of range(N)) {
    await prisma.commissionRule.create({
      data: {
        serviceType: pick(svcTypes, i),
        vehicleType: `SEED-${pick(RIDE_VEHICLES, i)}`,
        rate: faker.number.float({ min: 0.1, max: 0.25, fractionDigits: 4 }),
        isActive: i % 7 !== 0,
      },
    });
  }
  note('commissionRule', N);

  // ── Driver status ─────────────────────────────────────────────────────
  console.log('Seeding driver statuses…');
  const availabilities = ['OFFLINE', 'ONLINE', 'ON_TRIP'];
  for (const i of range(N)) {
    await prisma.driverStatus.create({
      data: {
        userId: drivers[i].id,
        availability: pick(availabilities, i),
        serviceMode: i % 3 === 0 ? 'LOGISTICS' : 'RIDES',
        vehicleType: pick(RIDE_VEHICLES, i),
        unsettledCashRideCount: i % 4,
      },
    });
  }
  note('driverStatus', N);

  // ── KYC ───────────────────────────────────────────────────────────────
  console.log('Seeding KYC…');
  const kycDocTypes = ['LICENSE', 'VEHICLE_REGISTRATION', 'ROADWORTHINESS', 'HACKNEY_PERMIT'];
  const kycStatuses = ['PENDING', 'APPROVED', 'REJECTED'];
  for (const i of range(N)) {
    const status = pick(kycStatuses, i);
    await prisma.kycDocument.create({
      data: {
        driverId: drivers[i].id,
        type: pick(kycDocTypes, i),
        fileKey: `seed/kyc/${uuid()}.jpg`,
        status,
        rejectionReason: status === 'REJECTED' ? faker.lorem.sentence() : null,
        reviewedById: status === 'PENDING' ? null : admin.id,
        reviewedAt: status === 'PENDING' ? null : past(20),
      },
    });
    await prisma.kycVerification.create({
      data: {
        driverId: drivers[i].id,
        type: i % 2 === 0 ? 'FACIAL' : 'GOVERNMENT_ID',
        provider: 'smile_identity',
        providerReference: `SID-${rand(100000, 999999)}`,
        status: pick(kycStatuses, i),
        rawResult: { score: rand(50, 99), ok: i % 3 !== 0 },
        verifiedAt: i % 3 === 0 ? null : past(15),
      },
    });
  }
  note('kycDocument', N);
  note('kycVerification', N);

  // ── Guarantors ────────────────────────────────────────────────────────
  console.log('Seeding guarantors…');
  const guarantorStatuses = ['INVITED', 'SUBMITTED', 'VERIFIED', 'REJECTED'];
  for (const i of range(N)) {
    const status = pick(guarantorStatuses, i);
    const submitted = status !== 'INVITED';
    await prisma.guarantor.create({
      data: {
        driverId: drivers[i].id,
        fullName: faker.person.fullName(),
        email: `seed.guarantor.${i}${SD}`,
        phone: `+23480${String(i).padStart(8, '0')}`,
        relationship: pick(['Employer', 'Family member', 'Colleague'], i),
        address: submitted ? faker.location.streetAddress() : null,
        occupation: submitted ? faker.person.jobTitle() : null,
        idType: submitted ? pick(['NIN', "Voter's Card", 'International Passport'], i) : null,
        idNumber: submitted ? String(rand(10000000, 99999999)) : null,
        idDocumentKey: submitted ? `seed/guarantor/${uuid()}.jpg` : null,
        status,
        tokenHash: tokenHex(),
        expiresAt: soon(14),
        submittedAt: submitted ? past(10) : null,
        reviewedById: ['VERIFIED', 'REJECTED'].includes(status) ? admin.id : null,
        reviewedAt: ['VERIFIED', 'REJECTED'].includes(status) ? past(5) : null,
        rejectionReason: status === 'REJECTED' ? faker.lorem.sentence() : null,
      },
    });
  }
  note('guarantor', N);

  // ── Device tokens ─────────────────────────────────────────────────────
  console.log('Seeding device tokens…');
  for (const i of range(N)) {
    await prisma.deviceToken.create({
      data: {
        userId: pick(allUsers, i).id,
        token: `seed-${uuid()}`,
        platform: pick(['ios', 'android', 'web'], i),
      },
    });
  }
  note('deviceToken', N);

  // ── Staff invites ─────────────────────────────────────────────────────
  console.log('Seeding staff invites…');
  const inviteStatuses = ['PENDING', 'ACCEPTED', 'REVOKED'];
  const supportRole = await prisma.role.findUnique({ where: { name: 'support' } }).catch(() => null);
  for (const i of range(N)) {
    const status = pick(inviteStatuses, i);
    await prisma.staffInvite.create({
      data: {
        email: `seed.invite.${i}${SD}`,
        tokenHash: tokenHex(),
        status,
        expiresAt: soon(7),
        revokedAt: status === 'REVOKED' ? past(2) : null,
        acceptedAt: status === 'ACCEPTED' ? past(3) : null,
        invitedById: admin.id,
        ...(supportRole ? { roles: { connect: { id: supportRole.id } } } : {}),
      },
    });
  }
  note('staffInvite', N);

  // ── Business team invites ─────────────────────────────────────────────
  console.log('Seeding business team invites…');
  for (const i of range(N)) {
    const status = pick(inviteStatuses, i);
    await prisma.businessTeamInvite.create({
      data: {
        email: `seed.bizinvite.${i}${SD}`,
        businessId: businesses[i].id,
        role: i % 2 === 0 ? 'BUSINESS_STAFF' : 'BUSINESS_ADMIN',
        tokenHash: tokenHex(),
        status,
        expiresAt: soon(7),
        revokedAt: status === 'REVOKED' ? past(2) : null,
        acceptedAt: status === 'ACCEPTED' ? past(3) : null,
        invitedById: bizAdmins[i].id,
      },
    });
  }
  note('businessTeamInvite', N);

  // ── Rides ────────────────────────────────────────────────────────────
  console.log('Seeding rides…');
  const rides = [];
  const variedRide = ['REQUESTED', 'DISPATCHING', 'IN_PROGRESS', 'CANCELLED', 'NO_DRIVERS_FOUND'];
  for (const i of range(N + 5)) {
    const completed = i < N;
    const status = completed ? 'COMPLETED' : pick(variedRide, i);
    const fare = money(1200, 9000);
    const commission = Number((fare * 0.18).toFixed(2));
    rides.push(
      await prisma.ride.create({
        data: {
          riderId: pick(riders, i).id,
          driverId: ['REQUESTED', 'NO_DRIVERS_FOUND'].includes(status) ? null : pick(drivers, i).id,
          status,
          vehicleType: pick(RIDE_VEHICLES, i),
          paymentMethod: i % 3 === 0 ? 'CASH' : 'WALLET',
          pickupLat: lagosLat(),
          pickupLng: lagosLng(),
          pickupAddress: faker.location.streetAddress(),
          dropoffLat: lagosLat(),
          dropoffLng: lagosLng(),
          dropoffAddress: faker.location.streetAddress(),
          serviceAreaId: pick(areas, i).id,
          distanceKm: money(1, 25),
          durationMinutes: rand(5, 60),
          estimatedFare: fare,
          finalFare: completed ? fare : null,
          commissionAmount: completed ? commission : null,
          cancelledById: status === 'CANCELLED' ? pick(riders, i).id : null,
          cancellationReason: status === 'CANCELLED' ? faker.lorem.sentence() : null,
          cancellationFee: status === 'CANCELLED' ? money(200, 600) : null,
          requestedAt: past(30),
          acceptedAt: completed ? past(29) : null,
          completedAt: completed ? past(28) : null,
          cancelledAt: status === 'CANCELLED' ? past(20) : null,
        },
      }),
    );
  }
  note('ride', rides.length);

  console.log('Seeding ride offers + ratings…');
  for (const i of range(N)) {
    await prisma.rideOffer.create({
      data: {
        rideId: rides[i].id,
        driverId: pick(drivers, i + 3).id,
        status: pick(['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'], i),
        expiresAt: soon(1),
        respondedAt: i % 2 === 0 ? past(10) : null,
      },
    });
    await prisma.rideRating.create({
      data: {
        rideId: rides[i].id,
        rating: rand(3, 5),
        comment: i % 2 === 0 ? faker.lorem.sentence() : null,
      },
    });
  }
  note('rideOffer', N);
  note('rideRating', N);

  // ── Deliveries ───────────────────────────────────────────────────────
  console.log('Seeding deliveries…');
  const deliveries = [];
  const variedDelivery = ['REQUESTED', 'DISPATCHING', 'ACCEPTED', 'PICKED_UP', 'CANCELLED'];
  for (const i of range(N + 5)) {
    const completed = i < N;
    const status = completed ? 'COMPLETED' : pick(variedDelivery, i);
    const businessBilled = i < 10;
    const fare = money(1500, 12000);
    const commission = Number((fare * 0.18).toFixed(2));
    deliveries.push(
      await prisma.delivery.create({
        data: {
          senderId: businessBilled ? bizAdmins[i].id : pick(riders, i).id,
          driverId: ['REQUESTED', 'DISPATCHING'].includes(status) ? null : pick(drivers, i).id,
          businessId: businessBilled ? businesses[i].id : null,
          status,
          vehicleType: pick(CARGO_VEHICLES, i),
          paymentMethod: businessBilled ? 'WALLET' : i % 3 === 0 ? 'CASH' : 'WALLET',
          pickupLat: lagosLat(),
          pickupLng: lagosLng(),
          pickupAddress: faker.location.streetAddress(),
          serviceAreaId: pick(areas, i).id,
          packageDescription: faker.commerce.productName(),
          packageValue: money(2000, 150000),
          receiverName: faker.person.fullName(),
          receiverPhone: `+23478${String(i).padStart(8, '0')}`,
          distanceKm: money(1, 30),
          durationMinutes: rand(10, 90),
          estimatedFare: fare,
          finalFare: completed ? fare : null,
          commissionAmount: completed ? commission : null,
          trackingToken: `seed-trk-${uuid()}`,
          receiverOtpVerifiedAt: completed ? past(12) : null,
          podType: completed ? pick(['OTP', 'SIGNATURE', 'PHOTO'], i) : null,
          podFileKey: completed && i % 2 === 0 ? `seed/pod/${uuid()}.jpg` : null,
          requestedAt: past(30),
          acceptedAt: completed ? past(29) : null,
          pickedUpAt: completed ? past(29) : null,
          completedAt: completed ? past(28) : null,
        },
      }),
    );
  }
  note('delivery', deliveries.length);

  console.log('Seeding delivery stops + offers…');
  for (const i of range(N)) {
    await prisma.deliveryStop.create({
      data: {
        deliveryId: deliveries[i].id,
        sequence: 1,
        lat: lagosLat(),
        lng: lagosLng(),
        address: faker.location.streetAddress(),
        status: 'COMPLETED',
        completedAt: past(28),
      },
    });
    await prisma.deliveryOffer.create({
      data: {
        deliveryId: deliveries[i].id,
        driverId: pick(drivers, i + 5).id,
        status: pick(['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'], i),
        expiresAt: soon(1),
        respondedAt: i % 2 === 0 ? past(10) : null,
      },
    });
  }
  note('deliveryStop', N);
  note('deliveryOffer', N);

  // ── Invoices ─────────────────────────────────────────────────────────
  console.log('Seeding invoices…');
  const invoiceStatuses = ['PENDING', 'PAID', 'OVERDUE'];
  for (const i of range(N)) {
    const linked = i < 10;
    const status = pick(invoiceStatuses, i);
    const amount = money(2000, 15000);
    await prisma.invoice.create({
      data: {
        businessId: businesses[i].id,
        deliveryId: linked ? deliveries[i].id : null,
        amount,
        commissionAmount: Number((amount * 0.18).toFixed(2)),
        description: `Delivery services — ${faker.date.month()} batch ${i + 1}`,
        status,
        dueAt: soon(30),
        paidAt: status === 'PAID' ? past(5) : null,
      },
    });
  }
  note('invoice', N);

  // ── Wallet: accounts + ledger ────────────────────────────────────────
  console.log('Seeding wallet accounts + ledger…');
  const treasury = await prisma.account.create({
    data: { type: 'PLATFORM_GATEWAY_CLEARING', ownerId: SEED_TREASURY_OWNER, balance: 0 },
  });
  const balances = { [treasury.id]: new Prisma.Decimal(0) };
  const riderWallets = [];
  const driverWallets = [];
  for (const i of range(N)) {
    const rw = await prisma.account.create({
      data: { type: 'RIDER_WALLET', ownerId: riders[i].id, balance: 0 },
    });
    const dw = await prisma.account.create({
      data: { type: 'DRIVER_WALLET', ownerId: drivers[i].id, balance: 0 },
    });
    riderWallets.push(rw);
    driverWallets.push(dw);
    balances[rw.id] = new Prisma.Decimal(0);
    balances[dw.id] = new Prisma.Decimal(0);
  }
  note('account', 1 + N * 2);

  async function postTx(type, reference, amount, entries) {
    const tx = await prisma.transaction.create({
      data: {
        type,
        status: 'COMPLETED',
        reference,
        amount: new Prisma.Decimal(amount),
        currency: 'NGN',
        completedAt: past(20),
      },
    });
    for (const e of entries) {
      const delta = e.direction === 'DEBIT' ? e.amount.negated() : e.amount;
      balances[e.accountId] = balances[e.accountId].plus(delta);
      await prisma.account.update({
        where: { id: e.accountId },
        data: { balance: balances[e.accountId] },
      });
      await prisma.ledgerEntry.create({
        data: {
          transactionId: tx.id,
          accountId: e.accountId,
          direction: e.direction,
          amount: e.amount,
          balanceAfter: balances[e.accountId],
        },
      });
    }
    note('transaction', 1);
    note('ledgerEntry', entries.length);
  }

  for (const i of range(N)) {
    const amount = new Prisma.Decimal(money(20000, 120000));
    await postTx('WALLET_TOPUP', `seed:topup:${i}`, amount, [
      { accountId: treasury.id, direction: 'DEBIT', amount },
      { accountId: riderWallets[i].id, direction: 'CREDIT', amount },
    ]);
  }
  for (const i of range(N)) {
    const fare = new Prisma.Decimal(money(1200, 8000));
    const commission = fare.times('0.18').toDecimalPlaces(2);
    const driverAmount = fare.minus(commission);
    await postTx('RIDE_PAYMENT_WALLET', `seed:ridepay:${i}`, fare, [
      { accountId: riderWallets[i].id, direction: 'DEBIT', amount: fare },
      { accountId: driverWallets[i].id, direction: 'CREDIT', amount: driverAmount },
      { accountId: treasury.id, direction: 'CREDIT', amount: commission },
    ]);
  }

  // ── Withdrawal requests ──────────────────────────────────────────────
  console.log('Seeding withdrawal requests…');
  for (const i of range(N)) {
    await prisma.withdrawalRequest.create({
      data: {
        driverId: drivers[i].id,
        amount: money(5000, 80000),
        settledCommission: i % 3 === 0 ? money(500, 3000) : 0,
        status: pick(['PENDING', 'COMPLETED', 'FAILED'], i),
        bankAccountId: `seed-bank-${uuid()}`,
        gatewayReference: i % 2 === 0 ? `PSK-${rand(100000, 999999)}` : null,
        completedAt: i % 3 === 1 ? past(4) : null,
      },
    });
  }
  note('withdrawalRequest', N);

  // ── Support tickets + messages ───────────────────────────────────────
  console.log('Seeding support tickets…');
  const ticketStatuses = ['OPEN', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'];
  const ticketCats = ['payment', 'ride', 'account', 'delivery', 'kyc'];
  let ticketMsgCount = 0;
  for (const i of range(N)) {
    const status = pick(ticketStatuses, i);
    const creator = pick(allUsers, i);
    const t = await prisma.supportTicket.create({
      data: {
        userId: creator.id,
        subject: faker.lorem.sentence(4),
        category: pick(ticketCats, i),
        status,
        priority: pick(['LOW', 'MEDIUM', 'HIGH', 'URGENT'], i),
        assignedToId: status === 'OPEN' ? null : admin.id,
        escalatedAt: status === 'ESCALATED' ? past(3) : null,
        resolvedAt: ['RESOLVED', 'CLOSED'].includes(status) ? past(2) : null,
        resolvedById: ['RESOLVED', 'CLOSED'].includes(status) ? admin.id : null,
      },
    });
    await prisma.supportTicketMessage.create({
      data: { ticketId: t.id, authorId: creator.id, body: faker.lorem.paragraph() },
    });
    ticketMsgCount++;
    if (status !== 'OPEN') {
      await prisma.supportTicketMessage.create({
        data: { ticketId: t.id, authorId: admin.id, body: faker.lorem.paragraph() },
      });
      ticketMsgCount++;
    }
  }
  note('supportTicket', N);
  note('supportTicketMessage', ticketMsgCount);

  // ── Kilowatt ─────────────────────────────────────────────────────────
  console.log('Seeding kilowatt…');
  const swapStations = [];
  for (const i of range(N)) {
    await prisma.chargingStation.create({
      data: {
        name: `[SEED] ${faker.company.name()} Charging Hub`,
        address: faker.location.streetAddress(true),
        lat: lagosLat(),
        lng: lagosLng(),
        chargerTypes: faker.helpers.arrayElements(['CCS', 'CHAdeMO', 'Type2', 'GB/T'], rand(1, 3)),
        connectorCount: rand(2, 12),
        speedKw: money(7, 150),
        pricePerKwh: money(80, 300),
        status: pick(['OPERATIONAL', 'MAINTENANCE', 'OFFLINE'], i),
        isActive: i % 6 !== 0,
      },
    });
    swapStations.push(
      await prisma.batterySwapStation.create({
        data: {
          name: `[SEED] ${faker.location.city()} Swap Point`,
          address: faker.location.streetAddress(true),
          lat: lagosLat(),
          lng: lagosLng(),
          totalSlots: rand(6, 24),
          availableBatteries: rand(0, 6),
          pricePerSwap: money(500, 2500),
          isActive: i % 5 !== 0,
        },
      }),
    );
  }
  note('chargingStation', N);
  note('batterySwapStation', N);

  for (const i of range(N)) {
    await prisma.batterySwapReservation.create({
      data: {
        userId: pick(drivers, i).id,
        stationId: swapStations[i].id,
        status: pick(['CONFIRMED', 'COMPLETED', 'CANCELLED'], i),
        amount: money(500, 2500),
        completedAt: i % 3 === 1 ? past(3) : null,
        cancelledAt: i % 3 === 2 ? past(3) : null,
      },
    });
  }
  note('batterySwapReservation', N);

  // ── Solar assessments ────────────────────────────────────────────────
  console.log('Seeding solar assessments…');
  for (const i of range(N)) {
    await prisma.solarAssessment.create({
      data: {
        userId: pick(allUsers, i).id,
        address: faker.location.streetAddress(true),
        lat: lagosLat(),
        lng: lagosLng(),
        monthlyBillEstimate: money(15000, 250000),
        propertyType: pick(['Residential', 'Commercial', 'Industrial'], i),
        notes: i % 2 === 0 ? faker.lorem.sentence() : null,
        status: pick(['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'CLOSED'], i),
        assignedRepId: i % 2 === 0 ? admin.id : null,
      },
    });
  }
  note('solarAssessment', N);

  // ── Promos + redemptions ─────────────────────────────────────────────
  console.log('Seeding promos…');
  const promos = [];
  for (const i of range(N)) {
    const type = i % 2 === 0 ? 'PERCENTAGE' : 'FLAT';
    promos.push(
      await prisma.promo.create({
        data: {
          code: `SEED${String(i).padStart(2, '0')}`,
          type,
          value: type === 'PERCENTAGE' ? rand(5, 40) : money(200, 2000),
          maxDiscount: type === 'PERCENTAGE' ? money(500, 3000) : null,
          usageLimitTotal: i % 3 === 0 ? rand(100, 1000) : null,
          usageLimitPerUser: 1,
          validFrom: past(30),
          validUntil: soon(60),
          applicableServices: faker.helpers.arrayElements(['RIDE', 'DELIVERY', 'KILOWATT'], rand(1, 3)),
          isActive: i % 8 !== 0,
        },
      }),
    );
  }
  note('promo', N);

  for (const i of range(N)) {
    await prisma.promoRedemption.create({
      data: {
        promoId: promos[i].id,
        userId: pick(riders, i).id,
        service: pick(['RIDE', 'DELIVERY', 'KILOWATT'], i),
        referenceId: rides[i] ? rides[i].id : uuid(),
        discountAmount: money(100, 2500),
      },
    });
  }
  note('promoRedemption', N);

  // ── Referrals ────────────────────────────────────────────────────────
  console.log('Seeding referrals…');
  const referralCodes = [];
  for (const i of range(N)) {
    referralCodes.push(
      await prisma.referralCode.create({
        data: { userId: riders[i].id, code: `SEEDREF${String(i).padStart(2, '0')}` },
      }),
    );
  }
  note('referralCode', N);

  for (const i of range(N)) {
    const status = pick(['QUALIFIED', 'PAID', 'PENDING'], i);
    await prisma.referralRedemption.create({
      data: {
        referralCodeId: referralCodes[i].id,
        referrerId: riders[i].id,
        referredUserId: drivers[i].id,
        status,
        earningsAmount: money(500, 5000),
        paidAt: status === 'PAID' ? past(4) : null,
      },
    });
  }
  note('referralRedemption', N);

  // ── Fleet partners ───────────────────────────────────────────────────
  console.log('Seeding fleet partners…');
  const fleetPartners = [];
  for (const i of range(N)) {
    fleetPartners.push(
      await prisma.fleetPartner.create({
        data: {
          name: `${faker.company.name()} Fleet (seed)`,
          contactEmail: `seed.fleet.${i}${SD}`,
          contactPhone: `+23471${String(i).padStart(8, '0')}`,
        },
      }),
    );
  }
  note('fleetPartner', N);

  for (const i of range(N)) {
    await prisma.fleetPartnerDriver.create({
      data: { fleetPartnerId: fleetPartners[i].id, driverId: drivers[i].id },
    });
  }
  note('fleetPartnerDriver', N);

  // ── Partner offers ───────────────────────────────────────────────────
  console.log('Seeding partner offers…');
  const partnerOffers = [];
  for (const i of range(N)) {
    partnerOffers.push(
      await prisma.partnerOffer.create({
        data: {
          title: faker.commerce.productName(),
          description: faker.lorem.sentence(),
          partnerName: `${faker.company.name()} (seed)`,
          audience: pick(['RIDER', 'DRIVER', 'BOTH'], i),
          isActive: i % 7 !== 0,
          validFrom: past(20),
          validUntil: soon(45),
        },
      }),
    );
  }
  note('partnerOffer', N);

  for (const i of range(N)) {
    await prisma.partnerOfferClaim.create({
      data: { offerId: partnerOffers[i].id, userId: pick(allUsers, i).id },
    });
  }
  note('partnerOfferClaim', N);

  // ── Notifications ────────────────────────────────────────────────────
  console.log('Seeding notifications…');
  const campaigns = [];
  for (const i of range(N)) {
    campaigns.push(
      await prisma.notificationCampaign.create({
        data: {
          title: `[SEED] ${faker.lorem.sentence(4)}`,
          body: faker.lorem.sentence(),
          category: pick(['PROMO', 'SYSTEM', 'RIDE', 'WALLET'], i),
          segment: i % 2 === 0 ? { role: 'RIDER' } : { userIds: [riders[0].id, riders[1].id] },
          scheduledFor: i % 3 === 0 ? soon(7) : null,
          createdById: admin.id,
          sentAt: i % 3 === 0 ? null : past(5),
        },
      }),
    );
  }
  note('notificationCampaign', N);

  for (const i of range(N * 2)) {
    await prisma.notification.create({
      data: {
        userId: pick(allUsers, i).id,
        category: pick(['RIDE', 'WALLET', 'PROMO', 'SYSTEM'], i),
        title: faker.lorem.sentence(4),
        body: faker.lorem.sentence(),
        metadata: { seed: true },
        readAt: i % 2 === 0 ? past(3) : null,
        campaignId: i < N ? campaigns[i].id : null,
      },
    });
  }
  note('notification', N * 2);

  // ── Audit log ────────────────────────────────────────────────────────
  console.log('Seeding audit log…');
  const auditActions = [
    ['user.suspend', 'User'],
    ['user.activate', 'User'],
    ['kyc.approve', 'KycDocument'],
    ['kyc.reject', 'KycDocument'],
    ['config.edit', 'PlatformConfig'],
    ['business.credit-limit', 'Business'],
  ];
  for (const i of range(N)) {
    const [action, targetType] = pick(auditActions, i);
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action,
        targetType,
        targetId: pick(allUsers, i).id,
        metadata: { note: faker.lorem.sentence(), seed: true },
        createdAt: past(25),
      },
    });
  }
  note('auditLog', N);

  // ── Scheduled reports ────────────────────────────────────────────────
  console.log('Seeding scheduled reports…');
  const reportTypes = ['RIDERS', 'DRIVERS', 'RIDES', 'LOGISTICS', 'BUSINESS', 'KILOWATT', 'FINANCE', 'SUPPORT'];
  for (const i of range(N)) {
    await prisma.scheduledReport.create({
      data: {
        type: pick(reportTypes, i),
        format: 'CSV',
        frequency: pick(['DAILY', 'WEEKLY', 'MONTHLY'], i),
        recipientEmail: `seed.reports.${i}${SD}`,
        createdById: admin.id,
        isActive: i % 5 !== 0,
        lastRunAt: i % 2 === 0 ? past(7) : null,
      },
    });
  }
  note('scheduledReport', N);

  // ── done ─────────────────────────────────────────────────────────────
  const summary = Object.entries(created)
    .sort()
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');
  console.log(`\nSeed complete. Rows created:\n${summary}`);
  console.log(
    `\nLogin for any seeded user:\n  email:    seed.user.<100..507>${SD}\n  password: ${SEED_PASSWORD}\n  (100-119 riders, 200-219 drivers, 300-319 business admins, 400-419 staff)`,
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('\nSeed failed:', err);
  console.error('\nRe-run  node scripts/seed-mock-data.js --yes  to clean up and retry.');
  await prisma.$disconnect();
  process.exit(1);
});
