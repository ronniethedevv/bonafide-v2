-- 0003_agent: market-maker agent tokens (hashed) and per-epoch progress phases.
-- Generated from prisma/schema.prisma with
--   prisma@6.19.3 migrate diff --from-url <db at 0002> --to-schema-datamodel prisma/schema.prisma --script
-- (minus the DROP of the runner's own _mmr_migrations table).

-- CreateTable
CREATE TABLE "agent_token" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "agent_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement_epoch" (
    "registrationId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_epoch_pkey" PRIMARY KEY ("registrationId","epoch")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_token_tokenHash_key" ON "agent_token"("tokenHash");

-- CreateIndex
CREATE INDEX "agent_token_accountId_idx" ON "agent_token"("accountId");

-- AddForeignKey
ALTER TABLE "agent_token" ADD CONSTRAINT "agent_token_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_epoch" ADD CONSTRAINT "engagement_epoch_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "engagement_registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

