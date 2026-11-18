// DD-27: proveFunding — the loan reached the committed wallets, proven against epoch 1's
// attested root with proveEpoch's openings (C1 + I2 + H2) and the registration binding
// (C2). Every assert runs against the compiled circuit.

import { describe, it, expect } from "vitest";
import * as rt from "@midnight-ntwrk/compact-runtime";
import {
  BLOCK_TIME,
  BOND_COIN,
  startDayFor,
  FUNDED_A,
  HAVE_BUILD,
  buildScenario,
  cloneWitness,
  epochEndOf,
  publishRoot,
  runLifecycle,
  runProveFunding,
  runRegister,
  runningEngagement,
  settle,
  type Scenario,
} from "./harness.js";

const SECRET = new Uint8Array(32).fill(0x99);
const R1 = new Uint8Array(32).fill(0x11);
const UNDER = /loan not received by the committed wallets \(DD-27\)/;
const WRONG_ROOT = /funding root is not epoch-1's attested root \(DD-27\)/;

/** register -> postBond -> activate, with `scenario`'s wallets and terms; no root published. */
async function activated(scenario: Scenario): Promise<{ id: Uint8Array; state: rt.ChargedState }> {
  const reg = await runRegister(scenario.witness, SECRET);
  let state = (await runLifecycle("postBond", [reg.id], { state: reg.state, coin: BOND_COIN })).state;
  state = (await runLifecycle("activate", [reg.id, startDayFor(BLOCK_TIME + 100n), BLOCK_TIME + 100n],
    { state, blockTime: BLOCK_TIME + 100n })).state;
  return { id: reg.id, state };
}

/** Activated, with `scenario`'s root published as epoch 1's. */
async function ready(scenario: Scenario) {
  const a = await activated(scenario);
  return { ...a, state: await publishRoot(a.state, 1n, scenario.rootOfRoots) };
}

describe.skipIf(!HAVE_BUILD)("DD-27: proveFunding", () => {
  it("passes when treasury inflows to member wallets equal loan_L0, once", async () => {
    const s = buildScenario(undefined, 0, FUNDED_A); // from_treasury 1 000 = loan_L0
    const r = await ready(s);
    const f = await runProveFunding(s.witness, r.id, s.rootOfRoots, r.state);
    expect(f.proven).toBe(true);
    await expect(runProveFunding(s.witness, r.id, s.rootOfRoots, f.state)).rejects.toThrow(/funding already proven \(DD-27\)/);
  });

  it("reverts when under-funded by one unit", async () => {
    const s = buildScenario(undefined, 0, { xferIn: 1_004n, fromTreasury: 999n });
    const r = await ready(s);
    await expect(runProveFunding(s.witness, r.id, s.rootOfRoots, r.state)).rejects.toThrow(UNDER);
  });

  it("a non-membership slot adds nothing (its low leaf is the funded wallet's)", async () => {
    // wallet B's non-membership opens A's leaf; counting it would double 600 to 1 200 ≥ 1 000
    const s = buildScenario(undefined, 0, { xferIn: 604n, fromTreasury: 600n });
    expect(s.witness.slotLeaves[1]!.addr).toBe(s.witness.slotLeaves[0]!.addr);
    const r = await ready(s);
    await expect(runProveFunding(s.witness, r.id, s.rootOfRoots, r.state)).rejects.toThrow(UNDER);
  });

  it("reverts when the root is not epoch 1's published root", async () => {
    const s = buildScenario(undefined, 0, FUNDED_A);
    const a = await activated(s);
    // nothing published
    await expect(runProveFunding(s.witness, a.id, s.rootOfRoots, a.state)).rejects.toThrow(WRONG_ROOT);
    // epoch 1 published with another root
    await expect(runProveFunding(s.witness, a.id, s.rootOfRoots, await publishRoot(a.state, 1n, R1))).rejects.toThrow(WRONG_ROOT);
    // the scenario's root, but published for epoch 2
    await expect(runProveFunding(s.witness, a.id, s.rootOfRoots, await publishRoot(a.state, 2n, s.rootOfRoots))).rejects.toThrow(WRONG_ROOT);
  });

  it("reverts when the wallets are not the registered ones (dropped wallet, other salt)", async () => {
    const s = buildScenario(undefined, 0, FUNDED_A);
    const r = await ready(s);
    const dropped = cloneWitness(s.witness);
    dropped.committedWallets[1] = 0n;
    dropped.activeCount = 1n;
    await expect(runProveFunding(dropped, r.id, s.rootOfRoots, r.state)).rejects.toThrow(/wallet commitment does not match registration \(C2\)/);
    const salt = cloneWitness(s.witness);
    salt.walletSalt[0] = salt.walletSalt[0]! ^ 1;
    await expect(runProveFunding(salt, r.id, s.rootOfRoots, r.state)).rejects.toThrow(/wallet commitment does not match registration \(C2\)/);
  });

  it("reverts when the terms are not the registered ones (a lowered loan_L0)", async () => {
    const s = buildScenario(undefined, 0, { xferIn: 604n, fromTreasury: 600n });
    const r = await ready(s);
    const low = cloneWitness(s.witness);
    low.terms.loan_L0 = 600n; // would make 600 enough
    await expect(runProveFunding(low, r.id, s.rootOfRoots, r.state)).rejects.toThrow(/terms commitment does not match registration \(C2\)/);
  });

  it("reverts when an opening is not in the root (inflated leaf, wrong pool entry)", async () => {
    const s = buildScenario(undefined, 0, { xferIn: 1_004n, fromTreasury: 999n });
    const r = await ready(s);
    const inflated = cloneWitness(s.witness);
    inflated.slotLeaves[0]!.from_treasury = 1_000n; // claims the missing unit without a matching tree
    await expect(runProveFunding(inflated, r.id, s.rootOfRoots, r.state)).rejects.toThrow(/slot Merkle path mismatch \(C1\)/);
    const pool = cloneWitness(s.witness);
    pool.poolEntry = { ...pool.poolEntry, poolAddr: pool.poolEntry.poolAddr + 1n };
    await expect(runProveFunding(pool, r.id, s.rootOfRoots, r.state)).rejects.toThrow(/pool inclusion path mismatch \(C1\)/);
  });

  it("reverts before activation", async () => {
    const s = buildScenario(undefined, 0, FUNDED_A);
    const reg = await runRegister(s.witness, SECRET);
    const st = await publishRoot(reg.state, 1n, s.rootOfRoots);
    await expect(runProveFunding(s.witness, reg.id, s.rootOfRoots, st)).rejects.toThrow(/engagement not running/);
  });
});

describe.skipIf(!HAVE_BUILD)("DD-27: settleEpoch requires proven funding", () => {
  it("a proven, published epoch cannot settle until funding is proven; then it can", async () => {
    const g = await runningEngagement({ proven: 1, fund: false });
    await expect(settle(g, g.state, 1n, epochEndOf(g, 1n))).rejects.toThrow(/funding not proven \(DD-27\)/);
    const f = await runProveFunding(g.scenario.witness, g.id, g.scenario.rootOfRoots, g.state);
    await expect(settle(g, f.state, 1n, epochEndOf(g, 1n))).resolves.toBeDefined();
  });
});
