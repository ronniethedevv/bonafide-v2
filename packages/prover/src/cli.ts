// MM prover CLI (demo). Runs the full fixture pipeline and prints the per-invariant
// verdict. Run with: pnpm --filter @mmr/prover demo
//
// In production this becomes `mmr-prove --engagement <file> --epoch <n>`, reading
// the MM's local witness store and a real epoch root; the printed verdict is the
// same shape.

import { runDemoEpoch } from "./demo.js";

async function main(): Promise<void> {
  const r = await runDemoEpoch();

  const line = "─".repeat(52);
  process.stdout.write(`${line}\n MM Reputation — epoch proof (demo)\n${line}\n`);
  process.stdout.write(`pools indexed      : ${r.poolCount}\n`);
  process.stdout.write(`root-of-roots      : ${r.rootOfRootsHex}\n`);
  process.stdout.write(`engagement         : ${r.engagement.id}\n`);
  process.stdout.write(`active wallets     : ${r.engagement.wallets.activeCount}\n`);
  process.stdout.write(`witness verifies   : ${r.witnessValid ? "yes" : "NO"}\n`);
  process.stdout.write(
    `uptime             : ${r.verdict.uptimeBuckets}/${r.verdict.totalBuckets} buckets\n`,
  );
  process.stdout.write(`${line}\n invariants\n${line}\n`);
  for (const [name, ok] of Object.entries(r.verdict.invariants)) {
    process.stdout.write(`  ${ok ? "✓" : "✗"}  ${name}\n`);
  }
  process.stdout.write(`${line}\n`);
  const overall = r.verdict.pass && r.witnessValid;
  process.stdout.write(` VERDICT: ${overall ? "PASS" : "FAIL"}\n${line}\n`);

  process.exitCode = overall ? 0 : 1;
}

main().catch((err: unknown) => {
  process.stderr.write(`prover demo failed: ${String(err)}\n`);
  process.exitCode = 1;
});
