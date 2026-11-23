-- 0005_midnight_key: a client's Midnight coin public key, saved by the client. A market
-- maker's registration names it as the bond's beneficiary (paid if the engagement
-- defaults), and the client's acceptance checks the registration against it.

-- AlterTable
ALTER TABLE "account" ADD COLUMN     "midnightCoinKey" TEXT;
