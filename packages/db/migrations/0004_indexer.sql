-- 0004_indexer: daily indexed epochs (public roots + IPFS manifests) and small
-- resumable worker state (the position-registry cache), for the Trigger.dev indexer.
-- Generated from prisma/schema.prisma with
--   prisma@6.19.3 migrate diff --from-url <db at 0003> --to-schema-datamodel prisma/schema.prisma --script
-- (minus the DROP of the runner's own _mmr_migrations table).

-- CreateTable
CREATE TABLE "indexed_epoch" (
    "chainId" INTEGER NOT NULL,
    "epoch" INTEGER NOT NULL,
    "startTs" INTEGER NOT NULL,
    "endTs" INTEGER NOT NULL,
    "startBlock" INTEGER NOT NULL,
    "endBlock" INTEGER NOT NULL,
    "endBlockHash" TEXT NOT NULL,
    "rootHex" TEXT NOT NULL,
    "manifestCid" TEXT NOT NULL,
    "poolCount" INTEGER NOT NULL,
    "manifest" JSONB NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indexed_epoch_pkey" PRIMARY KEY ("chainId","epoch")
);

-- CreateTable
CREATE TABLE "worker_state" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_state_pkey" PRIMARY KEY ("key")
);

