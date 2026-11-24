import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../config.js";
import type {
  AddressActivity,
  ChainProvider,
  EpochRange,
  PoolDescriptor,
  PriceSample,
} from "../provider.js";
import { parseAddr } from "@mmr/merkle";
import { runEpochTwice, snapshotFile } from "./run-epoch.js";

const POOL = parseAddr("0x00000000000000000000000000000000000000a1");

function activity(addr: bigint): AddressActivity {
  return {
    addr,
    isProtocol: false,
    baseStart: 1000n,
    baseEnd: 900n,
    quoteEnd: 50n,
    lpBase: 800n,
    lpQuote: 40n,
    xferIn: 0n,
    xferOut: 0n,
    fromTreasury: 1000n,
    swapBaseIn: 0n,
    swapBaseOut: 100n,
    swapQuoteIn: 50n,
    swapQuoteOut: 0n,
    depthBuckets: [
      {
        bucket: 0,
        perBand: [
          { bandBps: 50, minBid: 10n, minAsk: 10n },
          { bandBps: 100, minBid: 20n, minAsk: 20n },
          { bandBps: 200, minBid: 30n, minAsk: 30n },
          { bandBps: 500, minBid: 40n, minAsk: 40n },
        ],
      },
    ],
    flowWindows: [{ window: 0, buy: 50n, sell: 100n }],
    lpFirstActiveTs: 0,
  };
}

const range: EpochRange = {
  epoch: 7,
  startBlock: 900_000,
  endBlock: 1_000_000,
  endBlockHash: "0xdeadbeef",
  startTs: 1_000_000,
  endTs: 1_086_400,
};

/** A deterministic fake: same inputs -> same bytes, like a real archive RPC. */
class StableProvider implements ChainProvider {
  chainId(): number {
    return 8453;
  }
  async finalizedBlock(): Promise<number> {
    return 1_000_000;
  }
  async poolsAboveFloor(): Promise<PoolDescriptor[]> {
    return [{ poolAddr: POOL, token0: 1n, token1: 2n, liquidity: 20n, dex: "uniswap-v3" }];
  }
  async poolActivity(): Promise<AddressActivity[]> {
    return [activity(0x11n), activity(0x22n)];
  }
  async poolPriceSamples(_pool: PoolDescriptor, r: EpochRange): Promise<PriceSample[]> {
    return [
      { ts: r.endTs - 1000, price: 100n },
      { ts: r.endTs - 500, price: 100n },
    ];
  }
}

/** A broken provider whose activity drifts each call — the root must then differ. */
class DriftingProvider extends StableProvider {
  private n = 0n;
  override async poolActivity(): Promise<AddressActivity[]> {
    this.n += 1n;
    return [{ ...activity(0x11n), baseEnd: 900n + this.n }];
  }
}

describe("runEpochTwice", () => {
  it("builds twice and returns one byte-identical root", async () => {
    const res = await runEpochTwice(new StableProvider(), DEFAULT_CONFIG, range);
    expect(res.identical).toBe(true);
    expect(res.rootHex).toMatch(/^0x[0-9a-f]{64}$/);
    expect(res.manifest.poolCount).toBe(1);
    expect(res.manifest.rootOfRootsHex).toBe(res.rootHex);
  });

  it("runs the hook between the two builds, once", async () => {
    const calls: string[] = [];
    class Recording extends StableProvider {
      override async poolActivity(): Promise<AddressActivity[]> {
        calls.push("build");
        return super.poolActivity();
      }
    }
    await runEpochTwice(new Recording(), DEFAULT_CONFIG, range, undefined, () => calls.push("hook"));
    expect(calls).toEqual(["build", "hook", "build"]);
  });

  it("throws if the pipeline is not deterministic", async () => {
    await expect(runEpochTwice(new DriftingProvider(), DEFAULT_CONFIG, range)).rejects.toThrow(
      /non-deterministic root/,
    );
  });
});

describe("snapshotFile", () => {
  it("puts a file back as it was before the first run changed it", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mmr-snap-")), "registry.json");
    writeFileSync(path, "scanned to the day's start");
    const restore = snapshotFile(path);
    writeFileSync(path, "scanned to the day's end");
    restore();
    expect(readFileSync(path, "utf8")).toBe("scanned to the day's start");
  });

  it("removes a file the first run created when there was none", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mmr-snap-")), "registry.json");
    const restore = snapshotFile(path);
    writeFileSync(path, "new registry");
    restore();
    expect(existsSync(path)).toBe(false);
  });
});
