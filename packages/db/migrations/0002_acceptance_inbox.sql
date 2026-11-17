-- 0002_acceptance_inbox: client acceptance + the sealed MM-to-client channel.
-- Generated from prisma/schema.prisma with
--   prisma@6.19.3 migrate diff --from-url <db at 0001> --to-schema-datamodel prisma/schema.prisma --script
-- (minus the DROP of the runner's own _mmr_migrations table), plus the data update at the end.

-- AlterTable
ALTER TABLE "account" ADD COLUMN     "encryptionKey" TEXT;

-- AlterTable
ALTER TABLE "engagement_registration" ADD COLUMN     "acceptSignature" TEXT,
ADD COLUMN     "acceptedBy" TEXT,
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "termsCommit" TEXT,
ADD COLUMN     "walletCommit" TEXT,
ALTER COLUMN "status" SET DEFAULT 'proposed';

-- CreateTable
CREATE TABLE "engagement_message" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL DEFAULT 0,
    "envelope" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "engagement_message_registrationId_kind_epoch_key" ON "engagement_message"("registrationId", "kind", "epoch");

-- AddForeignKey
ALTER TABLE "engagement_message" ADD CONSTRAINT "engagement_message_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "engagement_registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: registrations made before acceptance existed now await the client.
UPDATE "engagement_registration" SET "status" = 'proposed' WHERE "status" = 'registered';
