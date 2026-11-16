import { describe, it, expect } from "vitest";
import {
  buildEpoch,
  DEFAULT_CONFIG,
  FLOW_WINDOWS,
  InMemoryPublisher,
  type AddressActivity,
  type ChainProvider,
  type EpochRange,
  type FlowWindowSample,
  type PoolDescriptor,
  type PriceSample,
} from "@mmr/indexer";
import type { Digest } from "@mmr/merkle";
import { PoseidonHasher } from "@mmr/merkle/poseidon";
import { createEngagement, type EngagementTerms } from "./engagement.js";
import { evaluateEpoch } from "./oracle.js";
import {
  assembleFlowOpenings,
  roundTripCapHolds,
  roundTripFromOpenings,
  verifyFlowOpenings,
} from "./flow-openings.js";

// Two wallets, flow across two windows, so round-trip and gross are non-trivial:
//   window 0: buy Σ=100, sell Σ=150 -> rt=100, gross=250
//   window 1: buy Σ= 50, sell Σ= 30 -> rt= 30, gross= 80
//   totals: roundTrip=130, gross=330
const POOL = 0xabcdn;
const WALLET_A = 0x10n;
const WALLET_B = 0x20n;

const RANGE: EpochRange = {
  epoch: 1,
  startBlock: 900_000,
  endBlock: 1_000_000,
  endBlockHash: "0xflow",
  startTs: 1_000_000,
  endTs: 1_086_400,
};

const TERMS: EngagementTerms = {
  floorPriceP: 1n,
  loanL0: 0n,
  quoteStartQ0: 0n,
  disposalD: 0n,
  netSellS: 1_000n,
  depthTarget: 0n,
  roundtripSharePpm: 400_000n, // 130*1e6 <= 400000*330 (132,000,000) -> holds
  bandBps: 100,
  minUptimeBuckets: 48, // every bucket (DEFAULT_CONFIG: 48 per epoch)
  epochsTotal: 30,
};

function activity(addr: bigint, flowWindows: FlowWindowSample[]): AddressActivity {
  return {
    addr,
    isProtocol: false,
    baseStart: 0n,
    baseEnd: 0n,
    quoteEnd: 0n,
    lpBase: 0n,
    lpQuote: 0n,
    xferIn: 0n,
    xferOut: 0n,
    fromTreasury: 0n,
    swapBaseIn: 0n,
    swapBaseOut: 0n,
    swapQuoteIn: 0n,
    swapQuoteOut: 0n,
    depthBuckets: [],
    flowWindows,
    lpFirstActiveBlock: null,
  };
}

const ACTIVITIES = new Map<bigint, AddressActivity>([
  [WALLET_A, activity(WALLET_A, [
    { window: 0, buy: 100n, sell: 100n },
    { window: 1, buy: 50n, sell: 0n },
  ])],
  [WALLET_B, activity(WALLET_B, [
    { window: 0, buy: 0n, sell: 50n },
    { window: 1, buy: 0n, sell: 30n },
  ])],
]);

class TestProvider implements ChainProvider {
  chainId(): number {
    return DEFAULT_CONFIG.chainId;
  }
  async finalizedBlock(): Promise<number> {
    return RANGE.endBlock;
  }
  async poolsAboveFloor(): Promise<PoolDescriptor[]> {
    return [{ poolAddr: POOL, token0: 1n, token1: 2n, liquidity: 1n, dex: "uniswap-v3" }];
  }
  async poolActivity(): Promise<AddressActivity[]> {
    return [...ACTIVITIES.values()];
  }
  async poolPriceSamples(): Promise<PriceSample[]> {
    return [{ ts: RANGE.endTs - 10, price: 100n }];
  }
}

async function buildFixture() {
  const hasher = new PoseidonHasher();
  const epoch = await buildEpoch(
    { provider: new TestProvider(), publisher: new InMemoryPublisher(), hasher, commitHasher: hasher },
    DEFAULT_CONFIG,
    RANGE,
  );
  const engagement = createEngagement({
    id: "flow-test",
    poolAddr: POOL,
    wallets: [WALLET_A, WALLET_B],
    salt: new Uint8Array(32).fill(5),
    terms: TERMS,
  });
  const tree = epoch.trees.get(POOL)!;
  const flowRootByAddr = new Map<bigint, Digest>(
    tree.leaves.filter((l) => l.addr !== 0n).map((l) => [l.addr, l.flowRoot]),
  );
  return { hasher, engagement, flowRootByAddr };
}

describe("M1 flow openings (I7)", () => {
  it("every wallet's full flow series verifies against its flow_root", async () => {
    const { hasher, engagement, flowRootByAddr } = await buildFixture();
    const openings = assembleFlowOpenings(engagement, ACTIVITIES);
    expect(openings.length).toBe(2);
    expect(openings.every((o) => o.opening.buy.length === FLOW_WINDOWS)).toBe(true);
    expect(verifyFlowOpenings(hasher, flowRootByAddr, openings)).toBe(true);
  });

  it("round-trip and gross from the bound openings equal the oracle's sums", async () => {
    const { engagement } = await buildFixture();
    const openings = assembleFlowOpenings(engagement, ACTIVITIES);

    const verdict = evaluateEpoch(engagement, ACTIVITIES, DEFAULT_CONFIG, RANGE, { settled: true });
    const totals = roundTripFromOpenings(openings);

    expect(totals.roundTripVolume).toBe(verdict.sums.roundTripVolume);
    expect(totals.grossVolume).toBe(verdict.sums.grossVolume);
    expect(totals.roundTripVolume).toBe(130n);
    expect(totals.grossVolume).toBe(330n);
    expect(roundTripCapHolds(totals, TERMS.roundtripSharePpm)).toBe(
      verdict.invariants.I7_roundTripCap,
    );
  });

  it("tampering an opened flow value breaks the binding (flow is not free)", async () => {
    const { hasher, engagement, flowRootByAddr } = await buildFixture();
    const openings = assembleFlowOpenings(engagement, ACTIVITIES);

    // Deflate wallet A's window-0 sell to shrink round-trip volume.
    const forged = openings.map((o) => {
      if (o.addr !== WALLET_A) return o;
      const sell = [...o.opening.sell];
      sell[0] = 0n;
      return { ...o, opening: { ...o.opening, sell } };
    });
    expect(verifyFlowOpenings(hasher, flowRootByAddr, forged)).toBe(false);
  });

  it("omitting a window is rejected: the whole series is committed (DD-14)", async () => {
    const { hasher, engagement, flowRootByAddr } = await buildFixture();
    const openings = assembleFlowOpenings(engagement, ACTIVITIES);

    // Drop wallet A's window 0 entirely (its round-trip-heavy window).
    const omitted = openings.map((o) => {
      if (o.addr !== WALLET_A) return o;
      const buy = [...o.opening.buy];
      const sell = [...o.opening.sell];
      buy[0] = 0n;
      sell[0] = 0n;
      return { ...o, opening: { buy, sell } };
    });
    expect(roundTripFromOpenings(omitted).roundTripVolume).toBeLessThan(130n); // would help a cheat
    expect(verifyFlowOpenings(hasher, flowRootByAddr, omitted)).toBe(false);
  });

  it("a series opened against another wallet's flow_root is rejected", async () => {
    const { hasher, engagement, flowRootByAddr } = await buildFixture();
    const [a, b] = assembleFlowOpenings(engagement, ACTIVITIES);
    const swapped = [{ ...a!, opening: b!.opening }, { ...b!, opening: a!.opening }];
    expect(verifyFlowOpenings(hasher, flowRootByAddr, swapped)).toBe(false);
  });
});
