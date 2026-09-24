-- Short, human-facing identifiers (e.g. TRP-7K3M9QX2) for the main business
-- entities, alongside the uuid primary keys.
--
-- Format: <3-letter prefix>-<8 chars of Crockford base32>. The alphabet drops
-- I, L, O and U so IDs read back over the phone without 1/I or 0/O mixups.
-- 32^8 ≈ 1.1 trillion combinations per prefix; the unique index is the final
-- guard against the (vanishingly rare) collision.
--
-- Randomness comes from gen_random_uuid() (core Postgres 13+, no pgcrypto
-- needed). Bytes 6 and 8 are skipped because they carry the uuid v4
-- version/variant bits. Each byte's low 5 bits index the 32-char alphabet
-- evenly (256 is a multiple of 32, so there's no modulo bias).
CREATE OR REPLACE FUNCTION kilo_short_id(prefix text) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  raw bytea := uuid_send(gen_random_uuid());
  idx int[] := ARRAY[0, 1, 2, 3, 4, 5, 10, 11];
  result text := '';
  i int;
BEGIN
  FOREACH i IN ARRAY idx LOOP
    result := result || substr(alphabet, (get_byte(raw, i) & 31) + 1, 1);
  END LOOP;
  RETURN prefix || '-' || result;
END;
$$;

-- Adding a column with a VOLATILE default makes Postgres evaluate it once per
-- existing row, so this backfills every table with distinct IDs.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "publicId" TEXT NOT NULL DEFAULT kilo_short_id('USR'::text);
CREATE UNIQUE INDEX "users_publicId_key" ON "users"("publicId");

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "publicId" TEXT NOT NULL DEFAULT kilo_short_id('TXN'::text);
CREATE UNIQUE INDEX "transactions_publicId_key" ON "transactions"("publicId");

-- AlterTable
ALTER TABLE "withdrawal_requests" ADD COLUMN "publicId" TEXT NOT NULL DEFAULT kilo_short_id('WDR'::text);
CREATE UNIQUE INDEX "withdrawal_requests_publicId_key" ON "withdrawal_requests"("publicId");

-- AlterTable
ALTER TABLE "rides" ADD COLUMN "publicId" TEXT NOT NULL DEFAULT kilo_short_id('TRP'::text);
CREATE UNIQUE INDEX "rides_publicId_key" ON "rides"("publicId");

-- AlterTable
ALTER TABLE "kyc_verifications" ADD COLUMN "publicId" TEXT NOT NULL DEFAULT kilo_short_id('KYC'::text);
CREATE UNIQUE INDEX "kyc_verifications_publicId_key" ON "kyc_verifications"("publicId");

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN "publicId" TEXT NOT NULL DEFAULT kilo_short_id('DLV'::text);
CREATE UNIQUE INDEX "deliveries_publicId_key" ON "deliveries"("publicId");

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN "publicId" TEXT NOT NULL DEFAULT kilo_short_id('BIZ'::text);
CREATE UNIQUE INDEX "businesses_publicId_key" ON "businesses"("publicId");

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "publicId" TEXT NOT NULL DEFAULT kilo_short_id('INV'::text);
CREATE UNIQUE INDEX "invoices_publicId_key" ON "invoices"("publicId");

-- AlterTable
ALTER TABLE "charging_stations" ADD COLUMN "publicId" TEXT NOT NULL DEFAULT kilo_short_id('CHG'::text);
CREATE UNIQUE INDEX "charging_stations_publicId_key" ON "charging_stations"("publicId");

-- AlterTable
ALTER TABLE "battery_swap_stations" ADD COLUMN "publicId" TEXT NOT NULL DEFAULT kilo_short_id('BSS'::text);
CREATE UNIQUE INDEX "battery_swap_stations_publicId_key" ON "battery_swap_stations"("publicId");

-- AlterTable
ALTER TABLE "battery_swap_reservations" ADD COLUMN "publicId" TEXT NOT NULL DEFAULT kilo_short_id('BSR'::text);
CREATE UNIQUE INDEX "battery_swap_reservations_publicId_key" ON "battery_swap_reservations"("publicId");

-- AlterTable
ALTER TABLE "solar_assessments" ADD COLUMN "publicId" TEXT NOT NULL DEFAULT kilo_short_id('SOL'::text);
CREATE UNIQUE INDEX "solar_assessments_publicId_key" ON "solar_assessments"("publicId");

-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN "publicId" TEXT NOT NULL DEFAULT kilo_short_id('TKT'::text);
CREATE UNIQUE INDEX "support_tickets_publicId_key" ON "support_tickets"("publicId");

-- AlterTable
ALTER TABLE "fleet_partners" ADD COLUMN "publicId" TEXT NOT NULL DEFAULT kilo_short_id('PTN'::text);
CREATE UNIQUE INDEX "fleet_partners_publicId_key" ON "fleet_partners"("publicId");

-- AlterTable
ALTER TABLE "partner_offers" ADD COLUMN "publicId" TEXT NOT NULL DEFAULT kilo_short_id('OFR'::text);
CREATE UNIQUE INDEX "partner_offers_publicId_key" ON "partner_offers"("publicId");
