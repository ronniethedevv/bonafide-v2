// @mmr/dapp — Phase 4 interact transcript: the full epoch_proof lifecycle against the
// contract already deployed to Midnight Preview.
//
//   pnpm --filter @mmr/dapp run interact
//   MMR_STOP_AFTER=proveFunding pnpm --filter @mmr/dapp run interact   # demo B1 tier
//
// MMR_STOP_AFTER=<circuit> ends the run cleanly after that circuit (register, postBond,
// activate, publishRoot, proveFunding, proveEpoch). The demo's live tier stops at
// proveFunding: everything up to it is <= k=17, while proveEpoch's k=20 proof peaks at
// ~9.5 GB and is OOM-killed on a 16 GB machine. MMR_ENGAGEMENT_SECRET=<64 hex> pins the
// engagement secret, which is otherwise random per run so re-runs never collide with an
// id a previous run already registered on the same chain.
//
// WHAT RUNS LIVE, IN ONE SESSION (no epoch-end gate — each is a real proof + tx):
//   register → activate → publishRoot(1)×2 → proveFunding → proveEpoch(1)
//   (+ optional postBond, + a bonus publishRoot of the genuine live-indexed root)
//
// WHAT IS TIME-GATED (NOT runnable now): settleEpoch / releaseEpoch / claim. The circuit
// asserts blockTimeGte(epochEnd) where epochEnd = activatedAt + e×86400 (24h), and the
// H3 timestamp checks forbid backdating activation. So an epoch cannot be settled until
// ~24h after activation (then releaseEpoch after its challenge window, then claim). Those
// are the `settleTail()` helpers below, guarded to no-op until the window opens; re-run
// this script after 24h (or exercise them in the time-advancing KAT suite, which sets the
// block clock). This is a property of the real schedule, not a gap in the demo.
//
// DATA PROVENANCE (honest caption for the demo):
//   • The ZK machinery, the contract, the 2-of-3 attester registry, and every proof here
//     are REAL and on Midnight Preview. The Merkle tree + openings are built by the same
//     @mmr/merkle / @mmr/prover / @mmr/indexer code the KATs verify (buildScenario) — not
//     mocked; only the *market numbers* are an engineered-compliant scenario, because the
//     per-wallet depth/flow witness PRE-IMAGES a passing proveEpoch needs are the MM's
//     private data and are deliberately NOT in any public artifact.
//   • The determinism of the real Base BROOMY/WETH epoch (rootOfRoots
//     0x5a3a6373…04461) is attested separately by the committed watcher KAT
//     (packages/watcher/fixtures/…, live-epoch.kat.test.ts). The optional bonus step below
//     publishes THAT genuine root into the on-chain attester registry, so the real
//     indexed root is demonstrably accepted by the deployed contract.
//
// LAPTOP-VERIFY markers flag the few midnight-js 4.1.1 runtime-API shapes that cannot be
// typechecked in the cloud (the compiled module is gitignored). Confirm them against the
// generated types on the first run; everything else (arg order, witness values, timing,
// committee alignment) is derived from the contract source + the KAT harness.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
// KAT-verified witness builder (real Poseidon tree + real openings). Exposed via
// @mmr/contracts/harness — these are pure assembly helpers; none of the compiled-module
// (BUILD_DIR) code paths of the harness are touched here.
import {
  buildScenario,
  cidBytes,
  FUNDED_A,
  TIER_MIN,
  CLIENT_PK,
  BOND_COIN,
  type EpochWitness,
} from "@mmr/contracts/harness";
import { generateAttesterSecrets } from "./committee.js";
import { loadConfig } from "./config.js";
import {
  PRIVATE_STATE_ID,
  compiledEpochProof,
  emptyPrivateState,
  type EpochProofPrivateState,
} from "./contract.js";
import { buildProviders } from "./providers.js";
import { buildHeadlessWallet } from "./wallet.js";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const nowSec = () => BigInt(Math.floor(Date.now() / 1000));

/** The deployed contract address, written by deploy.ts / batch-deploy-run.ts. */
function loadContractAddress(networkId: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = resolve(here, "..", ".deploy", `${networkId}.json`);
  const rec = JSON.parse(readFileSync(file, "utf8")) as { contractAddress?: string };
  if (!rec.contractAddress) throw new Error(`no contractAddress in ${file} — deploy first`);
  return rec.contractAddress;
}

/** Witness slots each circuit reads, pulled from the one KAT scenario (see harness.ts). */
function witnessBags(w: EpochWitness) {
  const common = {
    committedWallets: w.committedWallets,
    activeCount: w.activeCount,
    walletSalt: w.walletSalt,
    slotLeaves: w.slotLeaves,
    terms: w.terms,
    termsSalt: w.termsSalt,
    slotPaths: w.slotPaths,
    poolEntry: w.poolEntry,
    poolPath: w.poolPath,
  } satisfies Partial<EpochProofPrivateState>;
  return {
    register: (engagementSecret: Uint8Array): Partial<EpochProofPrivateState> => ({
      engagementSecret,
      committedWallets: w.committedWallets,
      walletSalt: w.walletSalt,
      terms: w.terms,
      termsSalt: w.termsSalt,
    }),
    // activate reads no witnesses (rootOfRoots is not read in-circuit).
    activate: (): Partial<EpochProofPrivateState> => ({}),
    publishRoot: (attesterSecret: Uint8Array): Partial<EpochProofPrivateState> => ({ attesterSecret }),
    proveFunding: (): Partial<EpochProofPrivateState> => ({ ...common }),
    proveEpoch: (): Partial<EpochProofPrivateState> => ({
      ...common,
      bidMin: w.bidMin,
      askMin: w.askMin,
      depthPaths: w.depthPaths,
      flowBuy: w.flowBuy,
      flowSell: w.flowSell,
      // epoch-1 genesis carry — buildScenario already sets these (ZERO prev, fill(0)/fill(0xc1)).
      carryPrev: w.carryPrev,
      carryPrevSalt: w.carryPrevSalt,
      carryNewSalt: w.carryNewSalt,
    }),
    postBond: (): Partial<EpochProofPrivateState> => ({ bondCoin: BOND_COIN }),
  };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  setNetworkId(cfg.networkId as Parameters<typeof setNetworkId>[0]);

  const contractAddress = loadContractAddress(cfg.networkId);
  console.log("mmr interact — epoch_proof lifecycle");
  console.log(`  network   ${cfg.networkId}`);
  console.log(`  contract  ${contractAddress}`);

  // The committee the deploy fixed on-chain: the SAME secrets deploy.ts used (committee.ts
  // generateAttesterSecrets(3)). We prove committee membership by the attesterSecret
  // witness, not the tx signer — so one wallet can cast both of the 2-of-3 publishRoot
  // votes by swapping the witness. (DD-26.)
  const attesterSecrets = generateAttesterSecrets(3);

  // The engagement under test. Its id is whatever register returns
  // (deriveEngagementId = persistentHash<Bytes<32>>(secret)).
  //
  // Randomised per run by default: register asserts the derived id is not already on the
  // status map, so a fixed secret makes the script single-use per chain — a re-run against
  // a chain that already holds that engagement dies on "engagement id already registered".
  // Set MMR_ENGAGEMENT_SECRET=<64 hex chars> to pin it (e.g. to re-derive the same id in a
  // recorded demo).
  const engagementSecret = (() => {
    const hexArg = process.env.MMR_ENGAGEMENT_SECRET?.trim();
    if (!hexArg) return crypto.getRandomValues(new Uint8Array(32));
    if (!/^[0-9a-fA-F]{64}$/.test(hexArg)) {
      throw new Error("MMR_ENGAGEMENT_SECRET must be exactly 64 hex characters (32 bytes).");
    }
    return Uint8Array.from(Buffer.from(hexArg, "hex"));
  })();

  // One compliant scenario (real tree + openings). FUNDED_A: wallet A's from_treasury =
  // 1000 ≥ loan_L0 (proveFunding I5); depth flatDepth(10) meets depth_target 10 (proveEpoch
  // I6). Genesis carry (epoch 1) is already set on the witness.
  // Stop cleanly after a named circuit instead of running the whole lifecycle. The demo's
  // B1 tier is `register -> proveFunding` (all <= k=17): proveEpoch's k=20 proof peaks at
  // ~9.5 GB and is OOM-killed on a 16 GB machine, so the live run stops before it and the
  // KAT suite covers proveEpoch with the real compiled circuit instead.
  const STOP_AFTER = process.env.MMR_STOP_AFTER?.trim() ?? "";
  const STOP_POINTS = [
    "register", "postBond", "activate", "publishRoot", "proveFunding", "proveEpoch",
  ] as const;
  if (STOP_AFTER !== "" && !STOP_POINTS.includes(STOP_AFTER as (typeof STOP_POINTS)[number])) {
    throw new Error(`MMR_STOP_AFTER must be one of: ${STOP_POINTS.join(", ")} (got "${STOP_AFTER}")`);
  }
  /** True once the named circuit is the configured stopping point. */
  const stopHere = (circuit: string) => STOP_AFTER === circuit;

  const scenario = buildScenario(undefined, 0, FUNDED_A);
  const root = scenario.rootOfRoots; // Uint8Array<32>
  const cid = cidBytes("mmr-preview-epoch1-scenario");
  const bags = witnessBags(scenario.witness);

  console.log("\nbuilding + syncing wallet…");
  const wallet = await buildHeadlessWallet(cfg);
  console.log(`  shielded  ${wallet.shieldedAddress}  NIGHT ${wallet.nightBalance}  DUST ${wallet.dustBalance}`);
  const providers = buildProviders(cfg, wallet.provider, wallet.shieldedAddress);
  const compiled = compiledEpochProof(cfg.zkConfigPath);

  try {
    // Reattach to the deployed contract. LAPTOP-VERIFY: on 4.1.1 the attach is
    // findDeployedContract(providers, { contractAddress, compiledContract, privateStateId,
    // initialPrivateState }); there is also a retained-era overload — confirm this shape.
    const found = await findDeployedContract(providers, {
      contractAddress,
      compiledContract: compiled,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: emptyPrivateState,
    });

    // Each circuit's witnesses come from the private state the witness closures in
    // contract.ts read. We stage the right bag before each call.
    // LAPTOP-VERIFY: that callTx re-reads the private state the provider holds at call
    // time (so set() before each call is the right mechanism). If 4.1.1 instead carries
    // witnesses another way for a call, adapt `stage` accordingly.
    const stage = async (bag: Partial<EpochProofPrivateState>) => {
      await providers.privateStateProvider.set(PRIVATE_STATE_ID, {
        ...emptyPrivateState,
        ...bag,
      });
    };

    // LAPTOP-VERIFY: callTx return shape. Phase 3 resolved it to { public: { txId,
    // blockHeight } }; proveEpoch additionally yields the disclosed EpochResult.
    const logTx = (label: string, res: { public?: { txId?: string; blockHeight?: unknown } }) => {
      const p = res?.public ?? {};
      console.log(`  ✓ ${label.padEnd(16)} tx ${p.txId ?? "?"}  block ${String(p.blockHeight ?? "?")}`);
    };

    /** Prints why the run ended early and what still covers the rest. */
    const stopped = (circuit: string) => {
      console.log(
        `\nStopped after \`${circuit}\` (MMR_STOP_AFTER). Every call above is a real proof and ` +
          `a real ContractCall in a block.\n` +
          `  The remaining circuits run in the KAT suite against the same compiled contract:\n` +
          `    pnpm --filter @mmr/contracts test`,
      );
    };

    // 1) register(declaredTier, registeredTs) → id. Timestamp must be ~now (H3, 10-min tol).
    await stage(bags.register(engagementSecret));
    const regRes = await found.callTx.register(1n, nowSec());
    logTx("register", regRes);
    // The engagement id is register's disclosed return (Bytes<32>). LAPTOP-VERIFY the exact
    // accessor: it is the circuit result, e.g. regRes.private?.result ?? regRes.public?.result.
    const id =
      (regRes as { private?: { result?: Uint8Array } }).private?.result ??
      (regRes as { public?: { result?: Uint8Array } }).public?.result;
    if (!(id instanceof Uint8Array)) {
      throw new Error("register did not return the engagement id (Bytes<32>) — check the callTx result shape");
    }
    console.log(`    id ${hex(id)}`);
    if (stopHere("register")) return stopped("register");

    // 2) (optional) postBond(id, tierMin, beneficiary). Needs a REAL escrow coin: the
    // bondCoin witness must be a UTXO the wallet actually holds (Zswap). Off by default
    // because the bond is only consumed by the time-gated settle/release tail. Set
    // MMR_POST_BOND=1 once a real coin is wired. LAPTOP-VERIFY the ZswapCoinPublicKey arg
    // encoding ({ bytes: Uint8Array<32> }) and real coin selection.
    if (process.env.MMR_POST_BOND === "1") {
      await stage(bags.postBond());
      logTx("postBond", await found.callTx.postBond(id, TIER_MIN, { bytes: CLIENT_PK }));
    } else {
      console.log("  · postBond            skipped (set MMR_POST_BOND=1 with a real escrow coin)");
    }
    if (stopHere("postBond")) return stopped("postBond");

    // 3) activate(id, rootOfRoots, activatedTs). Status Registered → Funded; must be within
    // the 72h funding window (it is — we just registered). rootOfRoots is not read here.
    await stage(bags.activate());
    logTx("activate", await found.callTx.activate(id, root, nowSec()));
    if (stopHere("activate")) return stopped("activate");

    // 4) publishRoot(epoch=1, root, cid) ×2 distinct committee members → publishedRoot[1].
    for (const i of [0, 1]) {
      await stage(bags.publishRoot(attesterSecrets[i]!));
      logTx(`publishRoot[1]#${i}`, await found.callTx.publishRoot(1n, root, cid));
    }
    if (stopHere("publishRoot")) return stopped("publishRoot");

    // 5) proveFunding(id, root): Σ from_treasury ≥ loan_L0, opened against publishedRoot[1].
    await stage(bags.proveFunding());
    logTx("proveFunding", await found.callTx.proveFunding(id, root));
    if (stopHere("proveFunding")) return stopped("proveFunding");

    // 6) proveEpoch(id, root, epoch=1): the heavy delivery proof (I1–I7 in-circuit). Binds
    // to publishedRoot[1] (already published above). Prints the disclosed uptime if present.
    await stage(bags.proveEpoch());
    const epRes = await found.callTx.proveEpoch(id, root, 1n);
    logTx("proveEpoch[1]", epRes);
    const epResult = (epRes as { private?: { result?: { uptime?: bigint } } }).private?.result;
    if (epResult?.uptime !== undefined) console.log(`    uptime ${epResult.uptime}`);
    if (stopHere("proveEpoch")) return stopped("proveEpoch");

    // BONUS — the genuine live-indexed Base BROOMY/WETH root in the on-chain registry.
    // Publishes the real attested rootOfRoots (0x5a3a…04461) at a spare epoch number, so
    // the actual indexed root is demonstrably accepted by the deployed attester committee.
    // Not proven against (its witness pre-images are private); purely a registry write.
    if (process.env.MMR_PUBLISH_REAL_ROOT === "1") {
      const live = loadLiveRoot();
      for (const i of [0, 1]) {
        await stage(bags.publishRoot(attesterSecrets[i]!));
        logTx(`publishRoot[live]#${i}`, await found.callTx.publishRoot(live.epoch, live.root, live.cid));
      }
      console.log(`    live root 0x${hex(live.root)} published at epoch ${live.epoch}`);
    }

    console.log(
      "\nLive lifecycle complete. settleEpoch/releaseEpoch/claim are time-gated " +
        "(epochEnd = activatedAt + 24h); re-run after the window, or see the KAT suite.",
    );
  } finally {
    await wallet.stop();
  }
}

/** The committed live Base epoch's attested root + cid, for the bonus registry write. */
function loadLiveRoot(): { epoch: bigint; root: Uint8Array; cid: Uint8Array } {
  const here = dirname(fileURLToPath(import.meta.url));
  const manifestPath = resolve(
    here,
    "../../watcher/fixtures/base-8453-broomy-weth-2026-10-21/manifest.json",
  );
  const m = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    rootOfRootsHex: string;
    pools: { cid: string }[];
  };
  const root = Uint8Array.from(Buffer.from(m.rootOfRootsHex.replace(/^0x/, ""), "hex"));
  if (root.length !== 32) throw new Error(`live rootOfRoots is ${root.length} bytes, expected 32`);
  // A spare epoch number that the scenario lifecycle never uses (its epochs_total is 3).
  return { epoch: 1_000_000n, root, cid: cidBytes(m.pools[0]?.cid ?? "mmr-live-base-broomy-weth") };
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error("\ninteract failed:", err);
    process.exit(1);
  },
);
