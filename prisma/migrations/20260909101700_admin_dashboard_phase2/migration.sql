-- CreateEnum
CREATE TYPE "BusinessStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "BatterySwapStationStatus" AS ENUM ('AVAILABLE', 'MAINTENANCE', 'UNAVAILABLE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ChargingStationStatus" ADD VALUE 'AVAILABLE';
ALTER TYPE "ChargingStationStatus" ADD VALUE 'BUSY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SolarLeadStatus" ADD VALUE 'SITE_VISIT';
ALTER TYPE "SolarLeadStatus" ADD VALUE 'AVAILABLE';

-- DropForeignKey
ALTER TABLE "solar_assessments" DROP CONSTRAINT "solar_assessments_userId_fkey";

-- AlterTable
ALTER TABLE "battery_swap_stations" ADD COLUMN     "status" "BatterySwapStationStatus" NOT NULL DEFAULT 'AVAILABLE';

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "status" "BusinessStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "charging_stations" ADD COLUMN     "availableBays" INTEGER;

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "deviceLabel" TEXT,
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "lastUsedAt" TIMESTAMP(3),
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "solar_assessments" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "energyNeed" TEXT,
ADD COLUMN     "systemSizeKw" DECIMAL(6,2),
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "_DirectPermissions" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_DirectPermissions_AB_unique" ON "_DirectPermissions"("A", "B");

-- CreateIndex
CREATE INDEX "_DirectPermissions_B_index" ON "_DirectPermissions"("B");

-- AddForeignKey
ALTER TABLE "solar_assessments" ADD CONSTRAINT "solar_assessments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DirectPermissions" ADD CONSTRAINT "_DirectPermissions_A_fkey" FOREIGN KEY ("A") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DirectPermissions" ADD CONSTRAINT "_DirectPermissions_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

