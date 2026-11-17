-- 0001_init: generated from prisma/schema.prisma with
--   prisma@6.19.3 migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
-- Applied once by scripts/migrate.mjs. Never edit an applied migration; add a new file.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "mm" (
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "headlineUptime" INTEGER NOT NULL,

    CONSTRAINT "mm_pkey" PRIMARY KEY ("handle")
);

-- CreateTable
CREATE TABLE "engagement" (
    "recordId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "sandbox" BOOLEAN NOT NULL,
    "epochsPassed" INTEGER NOT NULL,
    "epochsTotal" INTEGER NOT NULL,
    "kpiDepth" INTEGER NOT NULL,
    "kpiUptime" INTEGER NOT NULL,
    "kpiUtilization" INTEGER NOT NULL,
    "kpiCustody" INTEGER NOT NULL,
    "kpiNoRoundTrips" INTEGER NOT NULL,
    "custodyIntact" BOOLEAN NOT NULL,
    "bondPosted" TEXT NOT NULL,
    "bondStatus" TEXT NOT NULL,
    "completedAt" TEXT NOT NULL,

    CONSTRAINT "engagement_pkey" PRIMARY KEY ("recordId")
);

-- CreateTable
CREATE TABLE "epoch_point" (
    "id" SERIAL NOT NULL,
    "handle" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "uptime" INTEGER NOT NULL,
    "depth" INTEGER NOT NULL,

    CONSTRAINT "epoch_point_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "handle" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_wallet" (
    "address" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_wallet_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "engagement_registration" (
    "id" TEXT NOT NULL,
    "mmAccountId" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "commitment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'registered',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_registration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "engagement_handle_idx" ON "engagement"("handle");

-- CreateIndex
CREATE INDEX "epoch_point_handle_idx" ON "epoch_point"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "epoch_point_handle_epoch_key" ON "epoch_point"("handle", "epoch");

-- CreateIndex
CREATE UNIQUE INDEX "account_handle_key" ON "account"("handle");

-- CreateIndex
CREATE INDEX "account_wallet_accountId_idx" ON "account_wallet"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "engagement_registration_commitment_key" ON "engagement_registration"("commitment");

-- CreateIndex
CREATE INDEX "engagement_registration_mmAccountId_idx" ON "engagement_registration"("mmAccountId");

-- CreateIndex
CREATE INDEX "engagement_registration_clientAccountId_idx" ON "engagement_registration"("clientAccountId");

-- AddForeignKey
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_handle_fkey" FOREIGN KEY ("handle") REFERENCES "mm"("handle") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epoch_point" ADD CONSTRAINT "epoch_point_handle_fkey" FOREIGN KEY ("handle") REFERENCES "mm"("handle") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_wallet" ADD CONSTRAINT "account_wallet_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_registration" ADD CONSTRAINT "engagement_registration_mmAccountId_fkey" FOREIGN KEY ("mmAccountId") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_registration" ADD CONSTRAINT "engagement_registration_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

