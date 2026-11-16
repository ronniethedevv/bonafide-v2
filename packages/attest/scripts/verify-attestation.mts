// Client-side verification CLI. Given a published epoch fixture directory (manifest.json
// + pool-tree.json — in production the tree is fetched from IPFS by its CID), build the
// attestation, verify it against the tree, and print a verdict. This is the tool a client
// runs to check a market maker's claim with no trust in us.
//
//   npx tsx packages/attest/scripts/verify-attestation.mts <fixtureDir> [--revoke] [--days N]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PoseidonHasher } from "@mmr/merkle/poseidon";
import { buildAttestation, revokeAttestation, verifyAttestation, type AttestableEpoch } from "../src/index.js";

const dir = process.argv[2];
if (!dir) {
  process.stderr.write("usage: verify-attestation <fixtureDir> [--revoke] [--days N]\n");
  process.exit(2);
}
const revoke = process.argv.includes("--revoke");
const daysIdx = process.argv.indexOf("--days");
const validityDays = daysIdx >= 0 ? Number(process.argv[daysIdx + 1]) : undefined;

const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as AttestableEpoch;
const tree = new Uint8Array(readFileSync(join(dir, "pool-tree.json")));
const poolAddr = manifest.pools[0]!.poolAddr;

let att = buildAttestation(manifest, {
  attesterSet: { id: "mmr-committee-1", threshold: 2, size: 3 },
  ...(validityDays === undefined ? {} : { validityDays }),
});
if (revoke) att = revokeAttestation(att);

const trees = new Map([[poolAddr, tree]]);
const r = verifyAttestation(new PoseidonHasher(), att, trees);

process.stdout.write(`attestation ${att.schema} ${att.uid}\n`);
process.stdout.write(`  chain ${att.chainId} epoch ${att.epoch} blocks ${att.startBlock}-${att.endBlock}\n`);
process.stdout.write(`  root-of-roots ${att.rootOfRootsHex}\n`);
process.stdout.write(`  coverage: chains ${att.coverage.chains.join(",")} venues ${att.coverage.venues.join(",")}\n`);
process.stdout.write(`  attestedAt ${att.attestedAt} expiresAt ${att.expiresAt ?? "never"} revoked ${att.revoked}\n`);
process.stdout.write(`\nVERDICT: ${r.ok ? "VALID" : "INVALID"}  (freshness: ${r.freshness})\n`);
process.stdout.write(`  uidValid=${r.uidValid} rootVerified=${r.rootVerified} revoked=${r.revoked} expired=${r.expired}\n`);
if (r.reasons.length) process.stdout.write(`  reasons: ${r.reasons.join("; ")}\n`);
process.exitCode = r.ok ? 0 : 1;
