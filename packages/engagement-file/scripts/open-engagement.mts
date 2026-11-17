// Open an engagement file (saved from the register step) for the prover: decrypt it,
// rebuild the engagement with @mmr/prover, and check that the prover's own commitments
// (CompactHasher, byte-exact with the contract) match the ones that were registered.
// Prints a summary only: never the wallets, salts or engagement secret.
//
//   MMR_ENGAGEMENT_PASSPHRASE='…' npx tsx packages/engagement-file/scripts/open-engagement.mts <file>
//
// (Without the env var it asks for the passphrase on stdin.)

import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { CompactHasher } from "@mmr/merkle";
import { bytesToHex as proverHex } from "../src/bytes.js";
import { buildWalletVector, commitTerms, commitWallets, createEngagement } from "@mmr/prover";
import { hexToBytes, openFile, termsFromJson, type EngagementFile } from "../src/index.js";

const path = process.argv[2];
if (!path) {
  process.stderr.write("usage: open-engagement.mts <engagement-file.json>\n");
  process.exit(2);
}

async function passphrase(): Promise<string> {
  if (process.env.MMR_ENGAGEMENT_PASSPHRASE) return process.env.MMR_ENGAGEMENT_PASSPHRASE;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const p = await rl.question("Passphrase: ");
  rl.close();
  return p;
}

try {
  const file = JSON.parse(await readFile(path, "utf8")) as EngagementFile;
  const o = await openFile(file, await passphrase());
  const terms = termsFromJson(o.terms);
  const engagement = createEngagement({
    id: o.commitments.termsCommit.slice(2, 18),
    poolAddr: BigInt(o.pool.address),
    wallets: o.wallets.map((w) => BigInt(w)),
    salt: hexToBytes(o.secrets.walletSalt, 32),
    terms,
  });
  const hasher = new CompactHasher();
  const wc = proverHex(commitWallets(hasher, buildWalletVector(o.wallets.map((w) => BigInt(w))), hexToBytes(o.secrets.walletSalt, 32)));
  const tc = proverHex(commitTerms(hasher, terms, hexToBytes(o.secrets.termsSalt, 32)));
  const ok = wc === o.commitments.walletCommit && tc === o.commitments.termsCommit;
  process.stdout.write(
    JSON.stringify(
      {
        ok,
        pool: o.pool,
        epochsTotal: engagement.terms.epochsTotal,
        activeWallets: engagement.wallets.activeCount,
        walletCommit: o.commitments.walletCommit,
        termsCommit: o.commitments.termsCommit,
        proverWalletCommitMatches: wc === o.commitments.walletCommit,
        proverTermsCommitMatches: tc === o.commitments.termsCommit,
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(ok ? 0 : 1);
} catch (e) {
  process.stderr.write(`could not open engagement file: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
