-- CreateEnum
CREATE TYPE "PreferredLanguage" AS ENUM ('EN', 'HA', 'YO', 'IG');

-- CreateEnum
CREATE TYPE "SavedPlaceLabel" AS ENUM ('HOME', 'WORK', 'OTHER');

-- CreateEnum
CREATE TYPE "TopUpMethod" AS ENUM ('CARD', 'SAVED_CARD', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "TopUpPurpose" AS ENUM ('TOPUP', 'CARD_SETUP');

-- CreateEnum
CREATE TYPE "TopUpStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TariffServiceType" AS ENUM ('RIDE', 'PACKAGE', 'FREIGHT');

-- CreateEnum
CREATE TYPE "DeliveryServiceType" AS ENUM ('PACKAGE', 'FREIGHT');

-- CreateEnum
CREATE TYPE "PackageSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE', 'EXTRA_LARGE');

-- AlterEnum
ALTER TYPE "AccountType" ADD VALUE 'PLATFORM_TAX_PAYABLE';

-- AlterEnum
ALTER TYPE "RidePaymentMethod" ADD VALUE 'BUSINESS_INVOICE';

-- AlterEnum
ALTER TYPE "DeliveryStatus" ADD VALUE 'SCHEDULED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "nextOfKinName" TEXT,
ADD COLUMN     "nextOfKinPhone" TEXT,
ADD COLUMN     "preferredLanguage" "PreferredLanguage" NOT NULL DEFAULT 'EN';

-- AlterTable
ALTER TABLE "tariffs" ADD COLUMN     "description" TEXT,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "durationMultiplier" DECIMAL(4,2) NOT NULL DEFAULT 1,
ADD COLUMN     "serviceType" "TariffServiceType",
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "rides" ADD COLUMN     "promoDiscount" DECIMAL(18,2),
ADD COLUMN     "shareToken" TEXT,
ADD COLUMN     "subtotalFare" DECIMAL(18,2),
ADD COLUMN     "taxAmount" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "arrivedAtDropoffAt" TIMESTAMP(3),
ADD COLUMN     "arrivedAtPickupAt" TIMESTAMP(3),
ADD COLUMN     "deliveryNotes" TEXT,
ADD COLUMN     "isFragile" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "packageSize" "PackageSize",
ADD COLUMN     "podSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "promoDiscount" DECIMAL(18,2),
ADD COLUMN     "scheduledFor" TIMESTAMP(3),
ADD COLUMN     "serviceType" "DeliveryServiceType" NOT NULL DEFAULT 'PACKAGE',
ADD COLUMN     "subtotalFare" DECIMAL(18,2),
ADD COLUMN     "taxAmount" DECIMAL(18,2),
ADD COLUMN     "weightKg" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "promos" ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subtitle" TEXT,
ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "saved_places" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" "SavedPlaceLabel" NOT NULL,
    "name" TEXT,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_vehicles" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "year" INTEGER,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_cards" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorizationCode" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "expMonth" TEXT NOT NULL,
    "expYear" TEXT NOT NULL,
    "bank" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topup_requests" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "method" "TopUpMethod" NOT NULL,
    "purpose" "TopUpPurpose" NOT NULL DEFAULT 'TOPUP',
    "status" "TopUpStatus" NOT NULL DEFAULT 'PENDING',
    "saveCard" BOOLEAN NOT NULL DEFAULT false,
    "cardId" TEXT,
    "cardLast4" TEXT,
    "cardBrand" TEXT,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "accountName" TEXT,
    "accountExpiresAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topup_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_places_userId_label_idx" ON "saved_places"("userId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "driver_vehicles_driverId_key" ON "driver_vehicles"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "driver_vehicles_plateNumber_key" ON "driver_vehicles"("plateNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payment_cards_userId_signature_key" ON "payment_cards"("userId", "signature");

-- CreateIndex
CREATE UNIQUE INDEX "topup_requests_reference_key" ON "topup_requests"("reference");

-- CreateIndex
CREATE INDEX "topup_requests_userId_createdAt_idx" ON "topup_requests"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "rides_shareToken_key" ON "rides"("shareToken");

-- AddForeignKey
ALTER TABLE "saved_places" ADD CONSTRAINT "saved_places_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_vehicles" ADD CONSTRAINT "driver_vehicles_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_cards" ADD CONSTRAINT "payment_cards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topup_requests" ADD CONSTRAINT "topup_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topup_requests" ADD CONSTRAINT "topup_requests_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "payment_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

