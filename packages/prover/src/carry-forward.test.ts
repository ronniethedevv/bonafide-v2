import { describe, it, expect } from "vitest";
import { Sha256Hasher } from "@mmr/merkle";
import {
  DEFAULT_CONFIG,
  type AddressActivity,
  type EpochRange,
} from "@mmr/indexer";
import { createEngagement, type EngagementTerms } from "./engagement.js";
import { evaluateEpoch } from "./oracle.js";
import {
  ZERO_CARRY,
  addEpoch,
  carryCommit,
  carryStep,
  cumulativeI5Holds,
  genesisCarry,
  verifyCarryCommit,
  type CarryTotals,
} from "./carry-forward.js";

const hasher = new Sha256Hasher();
const salt = (b: number) => new Uint8Array(32).fill(b);

describe("I5 carry-forward commitment", () => {
  it("commitment round-trips and a tampered total is rejected", () => {
    const totals: CarryTotals = { xferIn: 5000n, xferOut: 1200n, fromTreasury: 3000n };
    const c = carryCommit(hasher, totals, salt(1));
    expect(verifyCarryCommit(hasher, c, totals, salt(1))).toBe(true);
    // wrong salt
    expect(verifyCarryCommit(hasher, c, totals, salt(2))).toBe(false);
    // tampered total
    expect(verifyCarryCommit(hasher, c, { ...totals, xferOut: 1199n }, salt(1))).toBe(false);
  });

  it("catches cumulative overrun that every per-epoch check passes", () => {
    // D = 1000 lifetime. Each epoch sends 400 out (no inflow), which is under D
    // on its own, but the running total crosses D in epoch 3.
    const D = 1000n;
    const perEpoch = { xferIn: 0n, xferOut: 400n, fromTreasury: 0n };

    // one epoch alone (400 out) is comfortably under the lifetime cap D
    expect(cumulativeI5Holds(addEpoch(ZERO_CARRY, perEpoch), D)).toBe(true);

    let totals = ZERO_CARRY;
    let commitment = genesisCarry(hasher, salt(0));
    const results = [];
    for (let e = 1; e <= 3; e++) {
      const r = carryStep(hasher, {
        prevCommitment: commitment,
        prevTotals: totals,
        prevSalt: salt(e - 1),
        epochSums: perEpoch,
        newSalt: salt(e),
        disposalD: D,
      });
      results.push(r);
      totals = r.newTotals;
      commitment = r.newCommitment;
    }

    expect(results.map((r) => r.capHolds)).toEqual([true, true, false]); // 400,800,1200
    expect(results.map((r) => r.chained)).toEqual([true, true, true]);
    expect(results[2]!.ok).toBe(false);
    expect(results[2]!.newTotals.xferOut).toBe(1200n);
  });

  it("rejects a broken chain (prevTotals not matching prevCommitment)", () => {
    const commitment = carryCommit(hasher, { xferIn: 0n, xferOut: 400n, fromTreasury: 0n }, salt(1));
    const r = carryStep(hasher, {
      prevCommitment: commitment,
      prevTotals: ZERO_CARRY, // lies about the prior totals
      prevSalt: salt(1),
      epochSums: { xferIn: 0n, xferOut: 100n, fromTreasury: 0n },
      newSalt: salt(2),
      disposalD: 1000n,
    });
    expect(r.chained).toBe(false);
    expect(r.ok).toBe(false);
  });

  it("feeds the oracle's per-epoch sums into the running total", () => {
    const range: EpochRange = {
      epoch: 1,
      startBlock: 900_000,
      endBlock: 1_000_000,
      endBlockHash: "0x00",
      startTs: 1_000_000,
      endTs: 1_086_400,
    };
    const terms: EngagementTerms = {
      floorPriceP: 1n,
      loanL0: 0n,
      quoteStartQ0: 0n,
      disposalD: 1_000n,
      netSellS: 1_000n,
      depthTarget: 0n,
      roundtripSharePpm: 1_000_000n,
      bandBps: 100,
    };
    const activity = (addr: bigint, xferOut: bigint): AddressActivity => ({
      addr,
      isProtocol: false,
      baseStart: 0n,
      baseEnd: 0n,
      quoteEnd: 0n,
      lpBase: 0n,
      lpQuote: 0n,
      xferIn: 2_000n,
      xferOut,
      fromTreasury: 0n,
      swapBaseIn: 0n,
      swapBaseOut: 0n,
      swapQuoteIn: 0n,
      swapQuoteOut: 0n,
      depthBuckets: [],
      flowWindows: [],
      lpFirstActiveBlock: null,
    });
    const eng = createEngagement({
      id: "carry",
      poolAddr: 0xabcdn,
      wallets: [0x10n],
      salt: salt(9),
      terms,
    });

    const v = evaluateEpoch(eng, new Map([[0x10n, activity(0x10n, 600n)]]), DEFAULT_CONFIG, range, {
      settled: true,
    });
    // per-epoch passes: 600 out + 0 treasury <= 2000 in + 1000 D
    expect(v.invariants.I5_outflowCap).toBe(true);

    const r = carryStep(hasher, {
      prevCommitment: genesisCarry(hasher, salt(0)),
      prevTotals: ZERO_CARRY,
      prevSalt: salt(0),
      epochSums: {
        xferIn: v.sums.xferIn,
        xferOut: v.sums.xferOut,
        fromTreasury: v.sums.fromTreasury,
      },
      newSalt: salt(1),
      disposalD: terms.disposalD,
    });
    expect(r.ok).toBe(true);
    expect(r.newTotals).toEqual({ xferIn: 2_000n, xferOut: 600n, fromTreasury: 0n });
  });
});
