/*
  Warnings:

  - You are about to drop the column `firstName` on the `staff_invites` table. All the data in the column will be lost.
  - You are about to drop the column `lastName` on the `staff_invites` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `staff_invites` table. All the data in the column will be lost.
  - You are about to drop the column `staffRole` on the `staff_invites` table. All the data in the column will be lost.
  - Made the column `email` on table `staff_invites` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "staff_invites" DROP COLUMN "firstName",
DROP COLUMN "lastName",
DROP COLUMN "phone",
DROP COLUMN "staffRole",
ALTER COLUMN "email" SET NOT NULL;

-- CreateIndex
CREATE INDEX "staff_invites_email_idx" ON "staff_invites"("email");
