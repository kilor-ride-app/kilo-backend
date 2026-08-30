-- CreateEnum
CREATE TYPE "DriverServiceMode" AS ENUM ('RIDES', 'LOGISTICS');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('REQUESTED', 'DISPATCHING', 'ACCEPTED', 'PICKED_UP', 'COMPLETED', 'CANCELLED', 'NO_DRIVERS_FOUND');

-- CreateEnum
CREATE TYPE "DeliveryOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DeliveryStopStatus" AS ENUM ('PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ProofOfDeliveryType" AS ENUM ('OTP', 'SIGNATURE', 'PHOTO');

-- AlterTable
ALTER TABLE "driver_statuses" ADD COLUMN     "serviceMode" "DriverServiceMode" NOT NULL DEFAULT 'RIDES';

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "driverId" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'REQUESTED',
    "vehicleType" TEXT NOT NULL,
    "paymentMethod" "RidePaymentMethod" NOT NULL DEFAULT 'WALLET',
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "pickupAddress" TEXT NOT NULL,
    "packageDescription" TEXT NOT NULL,
    "packageValue" DECIMAL(18,2),
    "receiverName" TEXT NOT NULL,
    "receiverPhone" TEXT NOT NULL,
    "distanceKm" DECIMAL(10,2),
    "durationMinutes" INTEGER,
    "estimatedFare" DECIMAL(18,2),
    "finalFare" DECIMAL(18,2),
    "commissionAmount" DECIMAL(18,2),
    "trackingToken" TEXT NOT NULL,
    "receiverOtpHash" TEXT,
    "receiverOtpVerifiedAt" TIMESTAMP(3),
    "podType" "ProofOfDeliveryType",
    "podFileKey" TEXT,
    "cancelledById" TEXT,
    "cancellationReason" TEXT,
    "cancellationFee" DECIMAL(18,2),
    "disputeReason" TEXT,
    "disputeResolution" TEXT,
    "disputeResolvedById" TEXT,
    "disputeResolvedAt" TIMESTAMP(3),
    "transactionId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_stops" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "address" TEXT NOT NULL,
    "status" "DeliveryStopStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_offers" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" "DeliveryOfferStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_trackingToken_key" ON "deliveries"("trackingToken");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_transactionId_key" ON "deliveries"("transactionId");

-- CreateIndex
CREATE INDEX "deliveries_senderId_status_idx" ON "deliveries"("senderId", "status");

-- CreateIndex
CREATE INDEX "deliveries_driverId_status_idx" ON "deliveries"("driverId", "status");

-- CreateIndex
CREATE INDEX "deliveries_status_idx" ON "deliveries"("status");

-- CreateIndex
CREATE INDEX "delivery_stops_deliveryId_sequence_idx" ON "delivery_stops"("deliveryId", "sequence");

-- CreateIndex
CREATE INDEX "delivery_offers_deliveryId_status_idx" ON "delivery_offers"("deliveryId", "status");

-- CreateIndex
CREATE INDEX "delivery_offers_driverId_status_idx" ON "delivery_offers"("driverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_offers_deliveryId_driverId_key" ON "delivery_offers"("deliveryId", "driverId");

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_stops" ADD CONSTRAINT "delivery_stops_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_offers" ADD CONSTRAINT "delivery_offers_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_offers" ADD CONSTRAINT "delivery_offers_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
