// poolActivity orchestration (Unit 3 / 2c): flows (DD-22), LP positions (DD-24) and
// quote-denominated depth (DD-23) for one pool over one epoch, assembled into the
// AddressActivity rows the leaf builder consumes. Every value is read at a pinned block
// or replayed from logs in (startBlock, endBlock]; replayed end state is checked against
// chain state at endBlock before anything is returned.

import type { ActivityParams, AddressActivity, DepthBucketSample, EpochRange, PoolDescriptor } from "../provider.js";
import type { ChainConfig } from "../chains.js";
import type { BlockHeader, EvmRpc } from "./rpc.js";
import { TOPIC0, decodeBurn, decodeLiquidityChange, decodeMint, addressToBigInt } from "./abi.js";
import { keccak256 } from "./keccak.js";
import { hexToBytes } from "./abi.js";
import { extractFlows, type AddressFlows, type ExtractOptions } from "./flows.js";
import { multicall, selector, SELECTOR, type Call } from "./multicall.js";
import { orientPool } from "./price.js";
import { windowIndex } from "./range.js";
import { getLogsChunked } from "./logs.js";
import {
  positionsFromHistory,
  type HistoryPositions,
  type RegisteredPosition,
  emptyRegistry,
  loadRegistry,
  poolKeyId,
  readPositionsAt,
  saveRegistry,
  scanRegistry,
  type Registry,
} from "./positions.js";
import { DepthError, directKey, npmKey, replayDepth, type TrackedPosition } from "./depth.js";

/** Leaves per pool tree (depth-16 indexed Merkle tree). */
export const MAX_LEAVES = 65_536;

export interface ActivityOptions extends ExtractOptions {
  /** Registry cache file; without it the registry is rebuilt (slow: every NFT id). */
  readonly registryPath?: string;
  /**
   * DD-25: find the pool's positions from its Mint history instead of the global
   * registry — scan pool Mint + position-manager IncreaseLiquidity from this block (the
   * pool's creation block) to the epoch start. Complete for NFT and direct positions.
   */
  readonly historyFromBlock?: number;
  readonly onStage?: (stage: string) => void;
}

const hex = (a: bigint): string => `0x${a.toString(16).padStart(40, "0")}`;
const word = (h: string, i = 0): bigint => BigInt(`0x${h.slice(2 + 64 * i, 66 + 64 * i)}`);
const int24Bytes = (t: number): string => (BigInt.asUintN(24, BigInt(t))).toString(16).padStart(6, "0");

/** pool.positions key: keccak256(abi.encodePacked(owner, tickLower, tickUpper)). */
export function directPositionKey(owner: bigint, tl: number, tu: number): string {
  const packed = hexToBytes(`0x${owner.toString(16).padStart(40, "0")}${int24Bytes(tl)}${int24Bytes(tu)}`);
  let out = "0x";
  for (const b of keccak256(packed)) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function extractPoolActivity(
  rpc: EvmRpc,
  chain: ChainConfig,
  pool: PoolDescriptor,
  range: EpochRange,
  params: ActivityParams,
  opts: ActivityOptions = {},
): Promise<AddressActivity[]> {
  const stage = opts.onStage ?? (() => {});
  const dex = chain.dexes[0]!;
  const npm = BigInt(dex.positionManager);
  const poolHex = hex(pool.poolAddr);
  const o = orientPool(chain.quoteAssets, pool.token0, pool.token1);
  const base = o.baseIsToken0 ? pool.token0 : pool.token1;
  const quote = o.baseIsToken0 ? pool.token1 : pool.token0;
  const [t0, t1, feeHex] = await multicall(
    rpc,
    [SELECTOR.token0, SELECTOR.token1, selector("fee()")].map((data) => ({ target: poolHex, data })),
    range.endBlock,
  );
  if (word(t0!) !== pool.token0 || word(t1!) !== pool.token1) {
    throw new DepthError(`pool ${poolHex} tokens do not match its descriptor`);
  }
  const fee = Number(word(feeHex!));

  const headers = new Map<number, Promise<BlockHeader>>();
  const header = (n: number): Promise<BlockHeader> => {
    let h = headers.get(n);
    if (!h) headers.set(n, (h = rpc.blockHeader(n)));
    return h;
  };
  const buckets = Math.ceil((range.endTs - range.startTs) / params.bucketSeconds);
  const windowOf = await windowIndex(header, range, params.bucketSeconds);

  // 1. One chunked scan (pool events + base Transfers + position-manager liquidity
  //    changes), receipts of swap txs, and the flow classification.
  stage("scan");
  const treasury = new Set(params.treasuryAddresses.map((a) => BigInt(a)));
  const { flows, logs } = await extractFlows(rpc, { pool: pool.poolAddr, base, quote, treasury, windowOf }, range, {
    ...opts,
    positionManager: npm,
  });

  // 2. NFT positions of this pool, then owner/liquidity at both ends.
  const key = poolKeyId(pool.token0, pool.token1, fee);
  let registered: RegisteredPosition[];
  let atStart: Set<bigint>;
  let historyDirect: HistoryPositions["direct"] = [];
  if (opts.historyFromBlock !== undefined) {
    stage("history");
    if (opts.historyFromBlock > range.startBlock) throw new DepthError("historyFromBlock is after the epoch start");
    const history = await getLogsChunked(
      rpc,
      { address: [poolHex, hex(npm)], topics: [[TOPIC0.mint, TOPIC0.increaseLiquidity]], fromBlock: opts.historyFromBlock, toBlock: range.startBlock },
      opts,
    );
    const found = await positionsFromHistory(rpc, pool.poolAddr, dex.positionManager, key, [...history, ...logs], [range.endBlock, range.startBlock]);
    const before = await positionsFromHistory(rpc, pool.poolAddr, dex.positionManager, key, history, [range.startBlock]);
    registered = found.nfts;
    atStart = new Set(before.nfts.map((p) => p.tokenId));
    historyDirect = found.direct;
  } else {
    stage("registry");
    let reg: Registry = opts.registryPath ? loadRegistry(opts.registryPath, dex.positionManager, [key]) : emptyRegistry(dex.positionManager, [key]);
    // A registry scanned after this epoch started may lack positions burned since then.
    if (reg.scannedAt > range.startBlock) reg = emptyRegistry(dex.positionManager, reg.pools);
    if (reg.scannedAt < range.startBlock) await scanRegistry(rpc, reg, range.startBlock);
    atStart = new Set((reg.byPool.get(key) ?? []).map((p) => p.tokenId));
    await scanRegistry(rpc, reg, range.endBlock); // ids minted during the epoch
    if (opts.registryPath) saveRegistry(opts.registryPath, reg);
    registered = reg.byPool.get(key) ?? [];
  }

  const changed = new Set<bigint>();
  for (const l of logs) {
    if (addressToBigInt(l.address) === npm && (l.topics[0] === TOPIC0.increaseLiquidity || l.topics[0] === TOPIC0.decreaseLiquidity)) {
      changed.add(decodeLiquidityChange(l).tokenId);
    }
  }
  const ids = registered.map((p) => p.tokenId);
  stage("positions");
  const [startState, endState] = [await readPositionsAt(rpc, dex.positionManager, ids, range.startBlock), await readPositionsAt(rpc, dex.positionManager, ids, range.endBlock)];

  const tracked: TrackedPosition[] = [];
  for (const p of registered) {
    const s = startState.get(p.tokenId)!;
    const e = endState.get(p.tokenId)!;
    if (s.liquidity === 0n && !changed.has(p.tokenId)) continue; // dead all epoch
    // DD-24 credit: same owner at both ends, minted this epoch (owner at end), or burned
    // this epoch (owner at start); a position that changed hands mid-epoch is not credited.
    const mintedNow = !atStart.has(p.tokenId) && s.owner === null;
    const owner =
      e.owner !== null && (e.owner === s.owner || mintedNow) ? e.owner : e.owner === null && s.owner !== null ? s.owner : null;
    if (owner === null) continue;
    tracked.push({ key: npmKey(p.tokenId), owner, tickLower: p.tickLower, tickUpper: p.tickUpper, liquidityStart: s.liquidity });
  }

  // 3. Direct (non-NFT) positions: the full history in history mode, else those
  //    touched this epoch.
  const direct = new Map<string, { owner: bigint; tl: number; tu: number }>();
  for (const d of historyDirect) direct.set(directKey(d.owner, d.tickLower, d.tickUpper), { owner: d.owner, tl: d.tickLower, tu: d.tickUpper });
  for (const l of logs) {
    if (addressToBigInt(l.address) !== pool.poolAddr || (l.topics[0] !== TOPIC0.mint && l.topics[0] !== TOPIC0.burn)) continue;
    const ev = l.topics[0] === TOPIC0.mint ? decodeMint(l) : decodeBurn(l);
    const owner = addressToBigInt(ev.owner);
    if (owner === npm) continue;
    direct.set(directKey(owner, ev.tickLower, ev.tickUpper), { owner, tl: ev.tickLower, tu: ev.tickUpper });
  }
  const directList = [...direct].sort(([a], [b]) => (a < b ? -1 : 1));
  const posCalls: Call[] = directList.map(([, d]) => ({
    target: poolHex,
    data: selector("positions(bytes32)") + directPositionKey(d.owner, d.tl, d.tu).slice(2),
  }));
  const [dStart, dEnd] = [await multicall(rpc, posCalls, range.startBlock), await multicall(rpc, posCalls, range.endBlock)];
  directList.forEach(([k, d], i) => {
    tracked.push({ key: k, owner: d.owner, tickLower: d.tl, tickUpper: d.tu, liquidityStart: word(dStart[i]!) });
  });

  // 4. Replay, then check the replayed end state against chain state.
  stage("depth");
  const [s0Start, s0End] = [
    await rpc.call(poolHex, SELECTOR.slot0, range.startBlock),
    await rpc.call(poolHex, SELECTOR.slot0, range.endBlock),
  ];
  const depth = replayDepth({
    pool: pool.poolAddr,
    positionManager: npm,
    baseIsToken0: o.baseIsToken0,
    bandsBps: params.bandsBps,
    sqrtPriceStart: word(s0Start),
    positions: tracked,
    logs,
    windowOf,
    buckets,
  });
  if (depth.sqrtPriceEnd !== word(s0End)) throw new DepthError("replayed end price differs from slot0 at endBlock");
  for (const p of tracked) {
    const got = depth.liquidityEnd.get(p.key)!;
    const want = p.key.startsWith("npm:")
      ? endState.get(BigInt(p.key.slice(4)))!.liquidity
      : word(dEnd[directList.findIndex(([k]) => k === p.key)]!);
    if (got !== want) throw new DepthError(`position ${p.key}: replayed liquidity ${got}, chain ${want} at endBlock`);
  }

  // 5. Address set, balances, rows.
  stage("balances");
  const addrs = new Set<bigint>([...flows.keys(), ...depth.owners.keys(), pool.poolAddr]);
  addrs.delete(0n);
  if (addrs.size > MAX_LEAVES) throw new DepthError(`pool ${poolHex} has ${addrs.size} addresses; a tree holds ${MAX_LEAVES}`);
  const list = [...addrs].sort((a, b) => (a < b ? -1 : 1));
  const balanceOf = (tok: bigint): Call[] =>
    list.map((a) => ({ target: hex(tok), data: `0x70a08231${a.toString(16).padStart(64, "0")}` }));
  const [bStart, bEnd, qEnd] = [
    await multicall(rpc, balanceOf(base), range.startBlock),
    await multicall(rpc, balanceOf(base), range.endBlock),
    await multicall(rpc, balanceOf(quote), range.endBlock),
  ];
  const zero: AddressFlows = {
    swapBaseIn: 0n, swapBaseOut: 0n, swapQuoteIn: 0n, swapQuoteOut: 0n,
    xferIn: 0n, xferOut: 0n, fromTreasury: 0n, poolLegBase: 0n, windows: new Map(),
  };
  return list.map((a, i): AddressActivity => {
    const f = flows.get(a) ?? zero;
    const d = depth.owners.get(a);
    const depthBuckets: DepthBucketSample[] = d?.depthBuckets ?? [];
    return {
      addr: a,
      isProtocol: a === pool.poolAddr || a === npm,
      baseStart: word(bStart[i]!),
      baseEnd: word(bEnd[i]!),
      quoteEnd: word(qEnd[i]!),
      lpBase: d?.lpBase ?? 0n,
      lpQuote: d?.lpQuote ?? 0n,
      xferIn: f.xferIn,
      xferOut: f.xferOut,
      fromTreasury: f.fromTreasury,
      swapBaseIn: f.swapBaseIn,
      swapBaseOut: f.swapBaseOut,
      swapQuoteIn: f.swapQuoteIn,
      swapQuoteOut: f.swapQuoteOut,
      depthBuckets,
      flowWindows: [...f.windows].sort(([x], [y]) => x - y).map(([window, w]) => ({ window, buy: w.buy, sell: w.sell })),
      lpFirstActiveBlock: d?.lpFirstActiveBlock ?? null,
    };
  });
}
