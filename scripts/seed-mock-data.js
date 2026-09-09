/*
 * Temporary mock data for admin-panel testing.
 *
 * Seeds ~20+ rows into every admin-relevant table (users, businesses,
 * service areas, tariffs, rides, deliveries, wallet ledger, KYC, support,
 * kilowatt, promos, referrals, partnerships, notifications, audit log, ...).
 *
 * Self-contained: no dependencies beyond @prisma/client + argon2 (both
 * already in `dependencies`), so it runs in the production/staging
 * container as-is. Random-but-deterministic — a fixed PRNG seed means every
 * run generates the same data.
 *
 * WHERE IT WRITES: whatever DATABASE_URL points at. There is no localhost
 * guard — you pick the target. It refuses to run without --yes so a bare
 * `node scripts/seed-mock-data.js` can't silently write to prod.
 *
 * Usage:
 *   node scripts/seed-mock-data.js --yes           # clean previous seed rows, then reseed
 *   node scripts/seed-mock-data.js --yes --reset   # only clean previous seed rows
 *   npm run seed:mock  /  npm run seed:mock:reset
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

const N = 20; // baseline rows per table
const SEED_PASSWORD = 'Passw0rd!seed';
const SD = '@seed.kilo.test'; // seeded-email suffix
const SEED_TREASURY_OWNER = 'seed-treasury-account';

const prisma = new PrismaClient();

// ── tiny deterministic data generator (replaces faker) ──────────────────
let _s = 0x9e3779b9 ^ 20240831;
function rnd() {
  // mulberry32
  _s |= 0;
  _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;
const floatr = (min, max, dp = 2) => Number((rnd() * (max - min) + min).toFixed(dp));
const one = (arr) => arr[Math.floor(rnd() * arr.length)];
const someOf = (arr, count) => {
  const c = [...arr];
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c.slice(0, count);
};

const FIRST = ['Ada', 'Chidi', 'Emeka', 'Ngozi', 'Tunde', 'Bola', 'Yemi', 'Ife', 'Sade', 'Musa', 'Aisha', 'Zainab', 'Ibrahim', 'Fatima', 'Kunle', 'Segun', 'Damola', 'Bisi', 'Uche', 'Obi', 'Nkechi', 'Chioma', 'Femi', 'Rotimi', 'Halima', 'Sani', 'Grace', 'Peter', 'Mary', 'David', 'Sarah', 'Daniel', 'Esther', 'Blessing', 'Victor', 'Joy'];
const LAST = ['Okafor', 'Adeyemi', 'Balogun', 'Okonkwo', 'Eze', 'Abubakar', 'Bello', 'Ogunleye', 'Nwosu', 'Afolabi', 'Danjuma', 'Chukwu', 'Oladipo', 'Mohammed', 'Ibeh', 'Uzoma', 'Adewale', 'Onyeka', 'Lawal', 'Yakubu', 'Obinna', 'Akande', 'Nwachukwu', 'Salami', 'Ojo'];
const CITY = ['Ikeja', 'Yaba', 'Surulere', 'Lekki', 'Victoria Island', 'Ajah', 'Ikoyi', 'Maryland', 'Gbagada', 'Apapa', 'Oshodi', 'Mushin', 'Festac', 'Ojota', 'Ketu', 'Agege', 'Isolo', 'Egbeda', 'Ojodu', 'Magodo'];
const STREET = ['Allen', 'Awolowo', 'Adeniran Ogunsanya', 'Herbert Macaulay', 'Opebi', 'Toyin', 'Admiralty', 'Bourdillon', 'Kudirat Abiola', 'Adeola Odeku', 'Ozumba Mbadiwe', 'Marina', 'Broad', 'Ikorodu', 'Aina', 'Ogunlana'];
const STREET_SUFFIX = ['Street', 'Road', 'Avenue', 'Close', 'Crescent', 'Way'];
const CO_PREFIX = ['Sterling', 'Zenith', 'Kobo', 'Swift', 'Andela', 'Flutter', 'Interswitch', 'Konga', 'Naija', 'Bolt', 'GIG', 'Cova', 'Renmo', 'Carbon', 'Kuda', 'Piggy', 'Cowry', 'TeamApt', 'Mono', 'Okra'];
const CO_SUFFIX = ['Technologies', 'Logistics', 'Ventures', 'Global', 'Solutions', 'Nigeria Ltd', 'Africa', 'Holdings', 'Systems', 'Group'];
const PRODUCT = ['Documents', 'Laptop', 'Phone accessories', 'Groceries', 'Clothing parcel', 'Auto parts', 'Books', 'Electronics', 'Medical supplies', 'Cosmetics', 'Food items', 'Small furniture', 'Shoes', 'Building materials', 'Art supplies'];
const JOB = ['Trader', 'Teacher', 'Engineer', 'Accountant', 'Civil servant', 'Business owner', 'Nurse', 'Driver', 'Banker', 'Contractor', 'Consultant', 'Sales representative'];
const PHRASE = ['Payment not reflecting on my wallet', 'Driver cancelled after accepting', 'App keeps logging me out', 'Delivery arrived later than expected', 'Cannot verify my phone number', 'Wrong fare charged for the trip', 'Need to update my bank details', 'Promo code did not apply', 'Requesting a refund for a failed ride', 'Account suspended without notice', 'Unable to upload KYC documents', 'Charging station was out of service'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const firstName = () => one(FIRST);
const lastName = () => one(LAST);
const fullName = () => `${one(FIRST)} ${one(LAST)}`;
const jobTitle = () => one(JOB);
const city = () => one(CITY);
const streetAddress = () => `${int(1, 199)} ${one(STREET)} ${one(STREET_SUFFIX)}`;
const companyName = () => `${one(CO_PREFIX)} ${one(CO_SUFFIX)}`;
const productName = () => one(PRODUCT);
const sentence = (n = 1) => Array.from({ length: n === 1 ? 1 : 1 }, () => one(PHRASE)).join(' ') + '.';
const paragraph = () => someOf(PHRASE, int(2, 4)).join('. ') + '.';
const avatarUrl = () => `https://i.pravatar.cc/150?img=${int(1, 70)}`;
const monthName = () => one(MONTHS);
const recentDate = (days) => new Date(Date.now() - int(0, days * 86400000));
const soonDate = (days) => new Date(Date.now() + int(0, days * 86400000));

// ── cleanup (marker-based, child-before-parent) ────────────────────────
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
    ['solarAssessment', { OR: [byUserEmail, { contactEmail: { endsWith: SD } }] }],
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
const money = (min, max) => floatr(min, max, 2);
const tokenHex = () => crypto.randomBytes(32).toString('hex');
const uuid = () => crypto.randomUUID();
const lagosLat = () => floatr(6.4, 6.65, 5);
const lagosLng = () => floatr(3.28, 3.55, 5);
const soon = (days) => soonDate(days);
const past = (days) => recentDate(days);

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
            firstName: firstName(),
            lastName: lastName(),
            email: `seed.user.${n}${SD}`,
            emailVerifiedAt: k % 3 === 0 ? past(30) : null,
            phone: `+23481${String(n).padStart(8, '0')}`,
            passwordHash,
            role,
            status,
            profilePhotoUrl: k % 2 === 0 ? avatarUrl() : null,
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
          name: `${companyName()} (seed)`,
          registrationNumber: `RC${int(100000, 999999)}`,
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
          name: `[SEED] ${city()} Zone ${i + 1}`,
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
        rate: floatr(0.1, 0.25, 4),
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
        rejectionReason: status === 'REJECTED' ? sentence() : null,
        reviewedById: status === 'PENDING' ? null : admin.id,
        reviewedAt: status === 'PENDING' ? null : past(20),
      },
    });
    await prisma.kycVerification.create({
      data: {
        driverId: drivers[i].id,
        type: i % 2 === 0 ? 'FACIAL' : 'GOVERNMENT_ID',
        provider: 'smile_identity',
        providerReference: `SID-${int(100000, 999999)}`,
        status: pick(kycStatuses, i),
        rawResult: { score: int(50, 99), ok: i % 3 !== 0 },
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
        fullName: fullName(),
        email: `seed.guarantor.${i}${SD}`,
        phone: `+23480${String(i).padStart(8, '0')}`,
        relationship: pick(['Employer', 'Family member', 'Colleague'], i),
        address: submitted ? streetAddress() : null,
        occupation: submitted ? jobTitle() : null,
        idType: submitted ? pick(['NIN', "Voter's Card", 'International Passport'], i) : null,
        idNumber: submitted ? String(int(10000000, 99999999)) : null,
        idDocumentKey: submitted ? `seed/guarantor/${uuid()}.jpg` : null,
        status,
        tokenHash: tokenHex(),
        expiresAt: soon(14),
        submittedAt: submitted ? past(10) : null,
        reviewedById: ['VERIFIED', 'REJECTED'].includes(status) ? admin.id : null,
        reviewedAt: ['VERIFIED', 'REJECTED'].includes(status) ? past(5) : null,
        rejectionReason: status === 'REJECTED' ? sentence() : null,
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
          pickupAddress: streetAddress(),
          dropoffLat: lagosLat(),
          dropoffLng: lagosLng(),
          dropoffAddress: streetAddress(),
          serviceAreaId: pick(areas, i).id,
          distanceKm: money(1, 25),
          durationMinutes: int(5, 60),
          estimatedFare: fare,
          finalFare: completed ? fare : null,
          commissionAmount: completed ? commission : null,
          cancelledById: status === 'CANCELLED' ? pick(riders, i).id : null,
          cancellationReason: status === 'CANCELLED' ? sentence() : null,
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
        rating: int(3, 5),
        comment: i % 2 === 0 ? sentence() : null,
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
          pickupAddress: streetAddress(),
          serviceAreaId: pick(areas, i).id,
          packageDescription: productName(),
          packageValue: money(2000, 150000),
          receiverName: fullName(),
          receiverPhone: `+23478${String(i).padStart(8, '0')}`,
          distanceKm: money(1, 30),
          durationMinutes: int(10, 90),
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
        address: streetAddress(),
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
        description: `Delivery services — ${monthName()} batch ${i + 1}`,
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

  async function postTx(type, reference, amount, entries, when) {
    const at = when || past(20);
    const tx = await prisma.transaction.create({
      data: {
        type,
        status: 'COMPLETED',
        reference,
        amount: new Prisma.Decimal(amount),
        currency: 'NGN',
        createdAt: at,
        completedAt: at,
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

  // ── Analytics history (time-series spread for the dashboard charts) ───
  // Everything above clusters ~20-30 days ago. The Platform Analytics,
  // top-up-trend and revenue-by-service endpoints need data spread across a
  // full year — plus a little in the last 24h — so every range filter
  // (day / 7days / month / 6months / year) renders something.
  console.log('Seeding analytics history…');

  const DAY = 86400000;
  const HIST_DAYS = 400; // > 13 months, covers the "year" range
  const at = (msAgo) => new Date(Date.now() - msAgo);

  // Ramp signups: spread the seeded riders'/drivers' createdAt across the
  // window so the "user growth" series climbs instead of spiking to full
  // count in the current bucket. (createdAt has no @updatedAt, so it's a
  // plain settable field.)
  const rampUsers = [...riders, ...drivers];
  for (let i = 0; i < rampUsers.length; i++) {
    const daysAgo = Math.round(((rampUsers.length - i) / rampUsers.length) * (HIST_DAYS - 20)) + int(0, 20);
    await prisma.user.update({
      where: { id: rampUsers[i].id },
      data: { createdAt: at(daysAgo * DAY) },
    });
  }

  // Bulk historical rides + deliveries (no ledger — analytics only reads
  // requestedAt / completedAt / status / commissionAmount).
  const histRides = [];
  const histDeliveries = [];
  for (let day = HIST_DAYS; day >= 1; day--) {
    const recent = day <= 30; // denser in the last month for daily buckets
    if (!recent && rnd() > 0.4) continue;
    const dayBase = Date.now() - day * DAY;
    const stamp = () => new Date(dayBase + int(0, 23) * 3600000 + int(0, 59) * 60000);

    for (let k = 0, n = recent ? int(2, 5) : int(1, 3); k < n; k++) {
      const requestedAt = stamp();
      const done = rnd() < 0.82;
      const fare = money(1200, 9000);
      histRides.push({
        riderId: pick(riders, int(0, N - 1)).id,
        driverId: pick(drivers, int(0, N - 1)).id,
        status: done ? 'COMPLETED' : one(['DISPATCHING', 'ACCEPTED', 'IN_PROGRESS', 'CANCELLED']),
        vehicleType: pick(RIDE_VEHICLES, int(0, RIDE_VEHICLES.length - 1)),
        paymentMethod: rnd() < 0.3 ? 'CASH' : 'WALLET',
        pickupLat: lagosLat(), pickupLng: lagosLng(), pickupAddress: streetAddress(),
        dropoffLat: lagosLat(), dropoffLng: lagosLng(), dropoffAddress: streetAddress(),
        serviceAreaId: pick(areas, int(0, N - 1)).id,
        distanceKm: money(1, 25),
        durationMinutes: int(5, 60),
        estimatedFare: fare,
        finalFare: done ? fare : null,
        commissionAmount: done ? Number((fare * 0.18).toFixed(2)) : null,
        requestedAt,
        acceptedAt: new Date(requestedAt.getTime() + int(1, 5) * 60000),
        completedAt: done ? new Date(requestedAt.getTime() + int(10, 55) * 60000) : null,
      });
    }

    for (let k = 0, n = recent ? int(1, 4) : int(0, 2); k < n; k++) {
      const requestedAt = stamp();
      const done = rnd() < 0.82;
      const fare = money(1500, 12000);
      histDeliveries.push({
        senderId: pick(riders, int(0, N - 1)).id,
        driverId: pick(drivers, int(0, N - 1)).id,
        status: done ? 'COMPLETED' : one(['DISPATCHING', 'ACCEPTED', 'PICKED_UP', 'CANCELLED']),
        vehicleType: pick(CARGO_VEHICLES, int(0, CARGO_VEHICLES.length - 1)),
        paymentMethod: rnd() < 0.3 ? 'CASH' : 'WALLET',
        pickupLat: lagosLat(), pickupLng: lagosLng(), pickupAddress: streetAddress(),
        serviceAreaId: pick(areas, int(0, N - 1)).id,
        packageDescription: productName(),
        packageValue: money(2000, 150000),
        receiverName: fullName(),
        receiverPhone: `+23478${String(int(0, 99999999)).padStart(8, '0')}`,
        distanceKm: money(1, 30),
        durationMinutes: int(10, 90),
        estimatedFare: fare,
        finalFare: done ? fare : null,
        commissionAmount: done ? Number((fare * 0.18).toFixed(2)) : null,
        trackingToken: `seed-trk-${uuid()}`,
        // a few unresolved disputes for the "needs attention" / disputed card
        disputeReason: done && rnd() < 0.05 ? sentence() : null,
        requestedAt,
        acceptedAt: new Date(requestedAt.getTime() + int(1, 5) * 60000),
        completedAt: done ? new Date(requestedAt.getTime() + int(20, 80) * 60000) : null,
      });
    }
  }

  // A handful in the last 24h so the "day" (hourly) range isn't empty.
  for (const h of [1, 2, 4, 6, 9, 11, 13, 15, 17, 19, 21, 23]) {
    const when = at(h * 3600000 - int(0, 55) * 60000);
    const done = when.getTime() < Date.now() - 3600000 && rnd() < 0.6;
    const fare = money(1200, 9000);
    histRides.push({
      riderId: pick(riders, int(0, N - 1)).id,
      driverId: pick(drivers, int(0, N - 1)).id,
      status: done ? 'COMPLETED' : one(['DISPATCHING', 'ACCEPTED', 'IN_PROGRESS']),
      vehicleType: pick(RIDE_VEHICLES, int(0, RIDE_VEHICLES.length - 1)),
      paymentMethod: rnd() < 0.3 ? 'CASH' : 'WALLET',
      pickupLat: lagosLat(), pickupLng: lagosLng(), pickupAddress: streetAddress(),
      dropoffLat: lagosLat(), dropoffLng: lagosLng(), dropoffAddress: streetAddress(),
      serviceAreaId: pick(areas, int(0, N - 1)).id,
      distanceKm: money(1, 25),
      durationMinutes: int(5, 60),
      estimatedFare: fare,
      finalFare: done ? fare : null,
      commissionAmount: done ? Number((fare * 0.18).toFixed(2)) : null,
      requestedAt: when,
      acceptedAt: new Date(when.getTime() + int(1, 5) * 60000),
      completedAt: done ? new Date(when.getTime() + int(10, 50) * 60000) : null,
    });
  }

  await prisma.ride.createMany({ data: histRides });
  await prisma.delivery.createMany({ data: histDeliveries });
  note('ride', histRides.length);
  note('delivery', histDeliveries.length);

  // Historical top-ups (top-up-trend chart) and Kilowatt payments
  // (revenue-by-service) — kept ledger-consistent via postTx.
  for (let k = 0; k < 110; k++) {
    const when = at(int(1, HIST_DAYS) * DAY - int(0, 23) * 3600000);
    const amount = new Prisma.Decimal(money(5000, 90000));
    const rw = pick(riderWallets, int(0, N - 1));
    await postTx(
      'WALLET_TOPUP',
      `seed:histtopup:${k}`,
      amount,
      [
        { accountId: treasury.id, direction: 'DEBIT', amount },
        { accountId: rw.id, direction: 'CREDIT', amount },
      ],
      when,
    );
  }
  for (const h of [3, 7, 12, 16, 20]) {
    const amount = new Prisma.Decimal(money(4000, 30000));
    const rw = pick(riderWallets, int(0, N - 1));
    await postTx(
      'WALLET_TOPUP',
      `seed:histtopup:today:${h}`,
      amount,
      [
        { accountId: treasury.id, direction: 'DEBIT', amount },
        { accountId: rw.id, direction: 'CREDIT', amount },
      ],
      at(h * 3600000),
    );
  }
  for (let k = 0; k < 45; k++) {
    const when = at(int(1, HIST_DAYS) * DAY);
    const amount = new Prisma.Decimal(money(800, 6000));
    const rw = pick(riderWallets, int(0, N - 1));
    await postTx(
      'KILOWATT_PAYMENT',
      `seed:histkw:${k}`,
      amount,
      [
        { accountId: rw.id, direction: 'DEBIT', amount },
        { accountId: treasury.id, direction: 'CREDIT', amount },
      ],
      when,
    );
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
        gatewayReference: i % 2 === 0 ? `PSK-${int(100000, 999999)}` : null,
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
        subject: one(PHRASE),
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
      data: { ticketId: t.id, authorId: creator.id, body: paragraph() },
    });
    ticketMsgCount++;
    if (status !== 'OPEN') {
      await prisma.supportTicketMessage.create({
        data: { ticketId: t.id, authorId: admin.id, body: paragraph() },
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
        name: `[SEED] ${companyName()} Charging Hub`,
        address: streetAddress(),
        lat: lagosLat(),
        lng: lagosLng(),
        chargerTypes: someOf(['CCS', 'CHAdeMO', 'Type2', 'GB/T'], int(1, 3)),
        connectorCount: int(2, 12),
        availableBays: int(0, 8),
        speedKw: money(7, 150),
        pricePerKwh: money(80, 300),
        status: pick(['AVAILABLE', 'BUSY', 'MAINTENANCE', 'OFFLINE'], i),
        isActive: i % 6 !== 0,
      },
    });
    swapStations.push(
      await prisma.batterySwapStation.create({
        data: {
          name: `[SEED] ${city()} Swap Point`,
          address: streetAddress(),
          lat: lagosLat(),
          lng: lagosLng(),
          totalSlots: int(6, 24),
          availableBatteries: int(0, 6),
          pricePerSwap: money(500, 2500),
          status: pick(['AVAILABLE', 'MAINTENANCE', 'UNAVAILABLE'], i),
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
    // Even rows: rider-submitted (linked user). Odd rows: admin-entered
    // leads with standalone contact details and no linked account.
    const adminLead = i % 2 === 1;
    const leadUser = adminLead ? null : pick(allUsers, i);
    await prisma.solarAssessment.create({
      data: {
        userId: leadUser ? leadUser.id : null,
        address: streetAddress(),
        lat: lagosLat(),
        lng: lagosLng(),
        monthlyBillEstimate: money(15000, 250000),
        propertyType: pick(['Duplex', 'Bungalow', 'Villa', 'Apartment', 'Condo'], i),
        notes: i % 2 === 0 ? sentence() : null,
        contactName: adminLead ? fullName() : null,
        contactPhone: adminLead ? `+23470${String(i).padStart(8, '0')}` : null,
        contactEmail: adminLead ? `solar.lead.${i}${SD}` : null,
        systemSizeKw: adminLead ? money(3, 15) : null,
        energyNeed: adminLead ? pick(['Partial home', 'Full home'], i) : null,
        status: pick(['NEW', 'CONTACTED', 'SITE_VISIT', 'CONVERTED', 'AVAILABLE'], i),
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
          value: type === 'PERCENTAGE' ? int(5, 40) : money(200, 2000),
          maxDiscount: type === 'PERCENTAGE' ? money(500, 3000) : null,
          usageLimitTotal: i % 3 === 0 ? int(100, 1000) : null,
          usageLimitPerUser: 1,
          validFrom: past(30),
          validUntil: soon(60),
          applicableServices: someOf(['RIDE', 'DELIVERY', 'KILOWATT'], int(1, 3)),
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
          name: `${companyName()} Fleet (seed)`,
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
          title: `${productName()} discount`,
          description: sentence(),
          partnerName: `${companyName()} (seed)`,
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
          title: `[SEED] ${one(PHRASE)}`,
          body: sentence(),
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
        title: one(PHRASE),
        body: sentence(),
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
        metadata: { note: sentence(), seed: true },
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
