-- AlterTable
ALTER TABLE "driver_statuses" ADD COLUMN     "unsettledCashRideCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "withdrawal_requests" ADD COLUMN     "settledCommission" DECIMAL(18,2) NOT NULL DEFAULT 0;
