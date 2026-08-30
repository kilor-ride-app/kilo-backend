-- CreateTable
CREATE TABLE "tariffs" (
    "id" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "serviceAreaId" TEXT,
    "baseFare" DECIMAL(18,2) NOT NULL,
    "perKmRate" DECIMAL(18,2) NOT NULL,
    "perMinuteRate" DECIMAL(18,2) NOT NULL,
    "minimumFare" DECIMAL(18,2) NOT NULL,
    "cancellationFee" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "vehicleType" TEXT,
    "rate" DECIMAL(5,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tariffs_vehicleType_serviceAreaId_isActive_idx" ON "tariffs"("vehicleType", "serviceAreaId", "isActive");

-- CreateIndex
CREATE INDEX "commission_rules_serviceType_vehicleType_isActive_idx" ON "commission_rules"("serviceType", "vehicleType", "isActive");

-- AddForeignKey
ALTER TABLE "tariffs" ADD CONSTRAINT "tariffs_serviceAreaId_fkey" FOREIGN KEY ("serviceAreaId") REFERENCES "service_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
