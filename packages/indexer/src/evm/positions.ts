// Position registry for Uniswap v3 position-manager NFTs (Unit 3 / 2c, DD-24).
//
// A position NFT's pool and tick range never change after mint, so they are cached:
// one state scan of NonfungiblePositionManager.positions(id) for every id, keeping the
// ids of the indexed pools. Burned ids revert (and stay burned), so a scan at block X
// serves every later epoch; later epochs extend it from the highest id scanned. Only
// public chain state goes in, so anyone can rebuild the registry and get the same ids.
// Owners and liquidity are dynamic and are read per epoch at its start and end blocks.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { EvmRpc } from "./rpc.js";
import { multicallTry, selector, type Call } from "./multicall.js";

export interface RegisteredPosition {
  readonly tokenId: bigint;
  readonly tickLower: number;
  readonly tickUpper: number;
}

/** Pool key as the position manager stores it: sorted tokens + fee. */
export const poolKeyId = (token0: bigint, token1: bigint, fee: number): string =>
  `${token0.toString(16)}:${token1.toString(16)}:${fee}`;

export interface Registry {
  readonly positionManager: string;
  /** Pool keys this registry holds positions for. */
  readonly pools: readonly string[];
  /** Every id ≤ scannedUpTo has been read (the highest id that existed at scannedAt). */
  scannedUpTo: bigint;
  /**
   * Block of the last scan. Positions burned before it are absent, so the registry only
   * serves epochs starting at or after it.
   */
  scannedAt: number;
  /** Pool key -> its positions, ascending by tokenId. */
  readonly byPool: Map<string, RegisteredPosition[]>;
}

export const SEL_NPM = {
  positions: selector("positions(uint256)"),
  ownerOf: selector("ownerOf(uint256)"),
} as const;

const word = (hex: string, i: number): bigint => BigInt(`0x${hex.slice(2 + 64 * i, 66 + 64 * i)}`);
const int24 = (v: bigint): number => Number(BigInt.asIntN(24, v));
const uintWord = (v: bigint): string => v.toString(16).padStart(64, "0");

/** Decoded positions(id): pool key, ticks, liquidity. */
export function decodePosition(hex: string): { key: string; tickLower: number; tickUpper: number; liquidity: bigint } {
  if (hex.length < 2 + 64 * 12) throw new Error(`short positions() return: ${hex.length}`);
  return {
    key: poolKeyId(word(hex, 2), word(hex, 3), Number(word(hex, 4))),
    tickLower: int24(word(hex, 5)),
    tickUpper: int24(word(hex, 6)),
    liquidity: word(hex, 7),
  };
}

export interface ScanOptions {
  readonly concurrency?: number;
  /** Ids per round of batches. Default 20 000. */
  readonly roundIds?: number;
  readonly onProgress?: (scannedUpTo: bigint, found: number) => void;
}

/**
 * Extend `reg` by scanning ids after `reg.scannedUpTo` at `block` until a whole round
 * comes back empty (every id unminted or burned): ids are minted sequentially, so a
 * fully empty round of 20 000 ids is past the last mint.
 */
export async function scanRegistry(rpc: EvmRpc, reg: Registry, block: number, opts: ScanOptions = {}): Promise<void> {
  const wanted = new Set(reg.pools);
  const round = BigInt(opts.roundIds ?? 20_000);
  for (;;) {
    const from = reg.scannedUpTo + 1n;
    const calls: Call[] = [];
    for (let id = from; id < from + round; id++) {
      calls.push({ target: reg.positionManager, data: SEL_NPM.positions + uintWord(id) });
    }
    const res = await multicallTry(rpc, calls, block, { concurrency: opts.concurrency ?? 4 });
    let top = -1n;
    res.forEach((r, i) => {
      if (r === null) return;
      top = from + BigInt(i);
      const p = decodePosition(r);
      if (!wanted.has(p.key)) return;
      const list = reg.byPool.get(p.key) ?? [];
      list.push({ tokenId: from + BigInt(i), tickLower: p.tickLower, tickUpper: p.tickUpper });
      reg.byPool.set(p.key, list);
    });
    reg.scannedAt = block;
    // Nothing exists in this round: past the last mint at `block`.
    if (top < 0n) return;
    // Ids are sequential: every id ≤ top was minted by `block`; ids above it may be
    // minted later and are left for the next scan.
    reg.scannedUpTo = top;
    let found = 0;
    for (const l of reg.byPool.values()) found += l.length;
    opts.onProgress?.(reg.scannedUpTo, found);
  }
}

export function emptyRegistry(positionManager: string, pools: readonly string[]): Registry {
  return { positionManager, pools: [...pools].sort(), scannedUpTo: 0n, scannedAt: 0, byPool: new Map() };
}

/**
 * Load a cached registry that covers `pools`. A cache for another position manager is
 * ignored; one missing some of `pools` yields an empty registry over the union (a full
 * rescan, since the new pools' old ids were never kept).
 */
export function loadRegistry(path: string, positionManager: string, pools: readonly string[]): Registry {
  const want = emptyRegistry(positionManager, pools);
  let doc: {
    positionManager: string;
    pools: string[];
    scannedUpTo: string;
    scannedAt: number;
    byPool: Record<string, [string, number, number][]>;
  };
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return want;
  }
  if (doc.positionManager !== positionManager) return want;
  if (!pools.every((p) => doc.pools.includes(p))) return emptyRegistry(positionManager, [...new Set([...doc.pools, ...pools])]);
  const byPool = new Map<string, RegisteredPosition[]>();
  for (const [k, list] of Object.entries(doc.byPool)) {
    byPool.set(k, list.map(([id, tl, tu]) => ({ tokenId: BigInt(id), tickLower: tl, tickUpper: tu })));
  }
  return { positionManager, pools: [...doc.pools].sort(), scannedUpTo: BigInt(doc.scannedUpTo), scannedAt: doc.scannedAt, byPool };
}

export function saveRegistry(path: string, reg: Registry): void {
  mkdirSync(dirname(path), { recursive: true });
  const byPool: Record<string, [string, number, number][]> = {};
  for (const k of [...reg.byPool.keys()].sort()) {
    byPool[k] = reg.byPool.get(k)!.map((p) => [p.tokenId.toString(), p.tickLower, p.tickUpper]);
  }
  writeFileSync(
    path,
    JSON.stringify({
      positionManager: reg.positionManager,
      pools: reg.pools,
      scannedUpTo: reg.scannedUpTo.toString(),
      scannedAt: reg.scannedAt,
      byPool,
    }),
  );
}

/** Owner and liquidity of each id at `block` (null owner = not minted yet, or burned). */
export async function readPositionsAt(
  rpc: EvmRpc,
  positionManager: string,
  ids: readonly bigint[],
  block: number,
): Promise<Map<bigint, { owner: bigint | null; liquidity: bigint }>> {
  const calls: Call[] = ids.flatMap((id) => [
    { target: positionManager, data: SEL_NPM.ownerOf + uintWord(id) },
    { target: positionManager, data: SEL_NPM.positions + uintWord(id) },
  ]);
  const res = await multicallTry(rpc, calls, block, { concurrency: 4 });
  const out = new Map<bigint, { owner: bigint | null; liquidity: bigint }>();
  ids.forEach((id, i) => {
    const o = res[2 * i];
    const p = res[2 * i + 1];
    out.set(id, { owner: o ? word(o, 0) : null, liquidity: p ? decodePosition(p).liquidity : 0n });
  });
  return out;
}
