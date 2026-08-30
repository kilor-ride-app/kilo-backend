-- CreateEnum
CREATE TYPE "SocialProvider" AS ENUM ('GOOGLE', 'APPLE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "pendingEmail" TEXT;

-- CreateTable
CREATE TABLE "social_identities" (
    "id" TEXT NOT NULL,
    "provider" "SocialProvider" NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_identities_userId_idx" ON "social_identities"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "social_identities_provider_providerUserId_key" ON "social_identities"("provider", "providerUserId");

-- AddForeignKey
ALTER TABLE "social_identities" ADD CONSTRAINT "social_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
