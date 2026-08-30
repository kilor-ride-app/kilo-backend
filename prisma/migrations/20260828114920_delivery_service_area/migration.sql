-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "serviceAreaId" TEXT;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_serviceAreaId_fkey" FOREIGN KEY ("serviceAreaId") REFERENCES "service_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
