// KAT (M3b): releaseEpoch pays exactly the earned tranche of the bond (DD-18).
//
// B = the posted bond, E = the committed epochs_total (public from registration).
// Each settled epoch releases one tranche to the bond owner; after k released epochs
// the cumulative release is exactly floor(B·k/E) — @mmr/protocol nextTranche — so a
// release above OR below the earned step reverts, and the tranches sum to B.

import { beforeAll, describe, expect, it } from "vitest";
import { cumulativeRelease, nextTranche } from "@mmr/protocol";
import {
  BOND_CALLER_PK, BOND_COIN, HAVE_BUILD, Status, T, buildScenario, cloneWitness, epochEndOf,
  graceDeadlineOf, runLifecycle, runRegister, runningEngagement, settle,
  type BondRun, type Engagement,
} from "./harness.js";

const E = 30; // every engagement runs 30 epochs (DD-35)

const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const sentTo = (r: BondRun, pk: Uint8Array) =>
  r.outputs.filter((o) => o.recipient.is_left && eq(o.recipient.left.bytes, pk)).reduce((a, o) => a + o.coinInfo.value, 0n);
/** Value sent to anyone but the owner or back to the contract. */
const sentElsewhere = (r: BondRun) =>
  r.outputs.filter((o) => o.recipient.is_left && !eq(o.recipient.left.bytes, BOND_CALLER_PK))
    .reduce((a, o) => a + o.coinInfo.value, 0n);

/** All E epochs proven and settled at their ends; `at` is after every challenge window. */
async function settledEngagement(bond: bigint): Promise<{ g: Engagement; state: BondRun["state"]; at: bigint }> {
  const g = await runningEngagement({ proven: E, coin: { ...BOND_COIN, value: bond } });
  let state = g.state;
  for (let e = 1n; e <= BigInt(E); e++) state = (await settle(g, state, e, epochEndOf(g, e))).state;
  return { g, state, at: epochEndOf(g, BigInt(E)) + T.CHALLENGE };
}

describe.skipIf(!HAVE_BUILD)("M3b: release tranches follow the proven-epoch schedule", () => {
  let g: Engagement;
  let state: BondRun["state"];
  let at: bigint;
  beforeAll(async () => { ({ g, state, at } = await settledEngagement(BOND_COIN.value)); });
  const release = (e: bigint, amount: bigint, s = state) =>
    runLifecycle("releaseEpoch", [g.id, e, amount], { state: s, blockTime: at });

  it("E and B are on the ledger: the committed epochs_total and the posted bond", async () => {
    const r = await release(1n, nextTranche(BOND_COIN.value, E, 0));
    expect(r.ledger.contractEpochs.lookup(g.id)).toBe(BigInt(E));
    expect(r.ledger.bondValue.lookup(g.id)).toBe(BOND_COIN.value);
  });

  it("honest releases pay floor(B·k/E) steps to the owner only, summing to the escrow", async () => {
    let s = state;
    let paid = 0n;
    // any settled epoch may go first; the k-th release always pays the k-th step
    const order = [3n, 1n, 2n, ...Array.from({ length: E - 3 }, (_, i) => BigInt(i + 4))];
    for (const [k, e] of order.entries()) {
      const amount = nextTranche(BOND_COIN.value, E, k);
      const r = await release(e, amount, s);
      expect(sentTo(r, BOND_CALLER_PK)).toBe(amount);
      expect(sentElsewhere(r)).toBe(0n);
      paid += amount;
      expect(paid).toBe(cumulativeRelease(BOND_COIN.value, E, k + 1));
      expect(paid <= BOND_COIN.value).toBe(true);
      expect(r.ledger.releasedTotal.lookup(g.id)).toBe(paid);
      s = r.state;
      if (k < E - 1) expect(r.status).toBe(Status.Funded);
      else {
        expect(r.escrowed).toBeUndefined();
        expect(r.status).toBe(Status.Settled);
      }
    }
    expect(paid).toBe(BOND_COIN.value);
  });

  it("rejects releasing more than the earned tranche", async () => {
    await expect(release(1n, 334n)).rejects.toThrow(/release exceeds the earned tranche \(M3b\)/);
    await expect(release(1n, BOND_COIN.value)).rejects.toThrow(/release exceeds the earned tranche \(M3b\)/);
    const r1 = await release(1n, 333n);
    // after one tranche (333) only 666 is earned at k = 2: 334 more would be 667
    await expect(release(2n, 334n, r1.state)).rejects.toThrow(/release exceeds the earned tranche \(M3b\)/);
  });

  it("rejects releasing less than the earned tranche (nothing is left stranded)", async () => {
    await expect(release(1n, 332n)).rejects.toThrow(/release below the earned tranche \(M3b\)/);
    await expect(release(1n, 0n)).rejects.toThrow(/release below the earned tranche \(M3b\)/);
  });

  it("each epoch releases once", async () => {
    const r1 = await release(1n, 333n);
    await expect(release(1n, 333n, r1.state)).rejects.toThrow(/epoch tranche already released \(M3b\)/);
  });

  it("no epoch beyond the contract can settle, release or default", async () => {
    await expect(settle(g, state, 31n, epochEndOf(g, 31n), undefined, { ...g.records[0]!, epoch: 31n }))
      .rejects.toThrow(/epoch outside the contract \(M3b\)/);
    await expect(release(31n, 333n)).rejects.toThrow(/epoch not settled \(H3b\)/);
    await expect(runLifecycle("defaultEngagement", [g.id, 31n], { state, blockTime: graceDeadlineOf(g, 31n) }))
      .rejects.toThrow(/epoch outside the contract \(M3b\)/);
  });

  it("a completed engagement cannot be defaulted afterwards", async () => {
    let s = state;
    for (let k = 0; k < E; k++) s = (await release(BigInt(k + 1), nextTranche(BOND_COIN.value, E, k), s)).state;
    await expect(runLifecycle("defaultEngagement", [g.id, 30n], { state: s, blockTime: graceDeadlineOf(g, 30n) }))
      .rejects.toThrow(/engagement not running/);
  });
});

describe.skipIf(!HAVE_BUILD)("M3b: an uneven bond still sums exactly to the escrow", () => {
  it("B = 10,001 over 30 epochs pays the floor(B·k/E) steps and empties escrow", async () => {
    const bond = 10_001n;
    const { g, state, at } = await settledEngagement(bond);
    let s = state;
    const paid: bigint[] = [];
    for (let k = 0; k < E; k++) {
      const amount = nextTranche(bond, E, k);
      const r = await runLifecycle("releaseEpoch", [g.id, BigInt(k + 1), amount], { state: s, blockTime: at });
      paid.push(sentTo(r, BOND_CALLER_PK));
      s = r.state;
      if (k === E - 1) expect(r.escrowed).toBeUndefined();
    }
    expect(paid).toEqual(Array.from({ length: E }, (_, k) => nextTranche(bond, E, k)));
    expect(paid.slice(0, 3)).toEqual([333n, 333n, 334n]);
    expect(paid.reduce((a, x) => a + x, 0n)).toBe(bond);
  });
});

describe.skipIf(!HAVE_BUILD)("M3b: the contract length is fixed at registration", () => {
  it("register accepts only the standard 30-epoch length (DD-35)", async () => {
    for (const bad of [0n, 29n, 31n, 90n]) {
      const w = cloneWitness(buildScenario().witness);
      w.terms.epochs_total = bad;
      await expect(runRegister(w, new Uint8Array(32).fill(0x99))).rejects.toThrow(/engagements run 30 epochs \(DD-35\)/);
    }
  });
});
