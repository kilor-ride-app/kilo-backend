/*
  Warnings:

  - Made the column `phone` on table `staff_invites` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "staff_invites" ALTER COLUMN "phone" SET NOT NULL;
