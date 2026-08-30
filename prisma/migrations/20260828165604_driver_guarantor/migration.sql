-- CreateEnum
CREATE TYPE "GuarantorStatus" AS ENUM ('INVITED', 'SUBMITTED', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "guarantors" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "fullName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "relationship" TEXT,
    "address" TEXT,
    "occupation" TEXT,
    "idType" TEXT,
    "idNumber" TEXT,
    "idDocumentKey" TEXT,
    "proofOfAddressKey" TEXT,
    "status" "GuarantorStatus" NOT NULL DEFAULT 'INVITED',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guarantors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guarantors_tokenHash_key" ON "guarantors"("tokenHash");

-- CreateIndex
CREATE INDEX "guarantors_driverId_idx" ON "guarantors"("driverId");

-- CreateIndex
CREATE INDEX "guarantors_status_idx" ON "guarantors"("status");

-- AddForeignKey
ALTER TABLE "guarantors" ADD CONSTRAINT "guarantors_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guarantors" ADD CONSTRAINT "guarantors_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
