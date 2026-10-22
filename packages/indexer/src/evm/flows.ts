// Per-address token flows for one pool over one epoch (Unit 3 / 2c, DD-22).
//
// Every base/quote Transfer touching an address is classified exactly once:
//   - swap tx (the pool emitted a Swap in it): the address's NET base/quote delta over
//     all of the tx's base/quote Transfers is its swap flow (DD-22: net token flow —
//     routers/executors net to zero, the pool itself is the counterparty and excluded);
//   - otherwise, a Transfer with the pool as counterparty is a pool leg (LP deposit,
//     withdrawal, fee collection, flash);
//   - otherwise it is a transfer (xferIn/xferOut, base token only — I5 is in base).
// So for every address: Δbalance(base) = swap net + pool legs + base xfers, which the
// live verification checks against balanceOf at both ends of the range.

import type { EvmRpc, RpcLog } from "./rpc.js";
import type { EpochRange } from "../provider.js";
import { getLogsChunked, type ChunkOptions } from "./logs.js";
import { TOPIC0, decodeTransfer, addressToBigInt } from "./abi.js";

export interface FlowWindow {
  buy: bigint;
  sell: bigint;
}

export interface AddressFlows {
  swapBaseIn: bigint;
  swapBaseOut: bigint;
  swapQuoteIn: bigint;
  swapQuoteOut: bigint;
  /** Base transfers in / out (not swaps, not pool legs). */
  xferIn: bigint;
  xferOut: bigint;
  /** Base transfer inflows whose sender is a treasury / loan source (⊆ xferIn). */
  fromTreasury: bigint;
  /** Net base moved by pool legs (positive = into the address). */
  poolLegBase: bigint;
  /** Swap flow per window: base bought / sold. */
  windows: Map<number, FlowWindow>;
}

export interface FlowInputs {
  readonly pool: bigint;
  readonly base: bigint;
  readonly quote: bigint;
  readonly treasury: ReadonlySet<bigint>;
  /** Pool Swap/Mint/Burn logs and base-token Transfer logs over (startBlock, endBlock]. */
  readonly logs: readonly RpcLog[];
  /** Full receipts' logs for every tx that has a Swap on the pool, keyed by tx hash. */
  readonly swapTxLogs: ReadonlyMap<string, readonly RpcLog[]>;
  /** Flow window (bucket) of a block. */
  readonly windowOf: (block: number) => number;
}

export class FlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowError";
  }
}

function emptyFlows(): AddressFlows {
  return {
    swapBaseIn: 0n,
    swapBaseOut: 0n,
    swapQuoteIn: 0n,
    swapQuoteOut: 0n,
    xferIn: 0n,
    xferOut: 0n,
    fromTreasury: 0n,
    poolLegBase: 0n,
    windows: new Map(),
  };
}

const ZERO = 0n;

/** Hashes of the txs in which the pool emitted a Swap. */
export function swapTxHashes(pool: bigint, logs: readonly RpcLog[]): string[] {
  const out = new Set<string>();
  for (const l of logs) {
    if (addressToBigInt(l.address) === pool && l.topics[0] === TOPIC0.swap) out.add(l.transactionHash);
  }
  return [...out].sort();
}

export function classifyFlows(inp: FlowInputs): Map<bigint, AddressFlows> {
  const flows = new Map<bigint, AddressFlows>();
  const of = (a: bigint): AddressFlows => {
    let f = flows.get(a);
    if (!f) flows.set(a, (f = emptyFlows()));
    return f;
  };
  const isTransferOf = (l: RpcLog, token: bigint): boolean =>
    l.topics[0] === TOPIC0.transfer && l.topics.length === 3 && addressToBigInt(l.address) === token;

  // 1. Swap txs: net base/quote delta per address over the full receipt.
  const swapTxs = new Set(swapTxHashes(inp.pool, inp.logs));
  for (const tx of swapTxs) {
    const receipt = inp.swapTxLogs.get(tx);
    if (!receipt) throw new FlowError(`missing receipt for swap tx ${tx}`);
    // The scan's base Transfers in this tx must be exactly the receipt's (cross-source check).
    const fromScan = inp.logs.filter((l) => l.transactionHash === tx && isTransferOf(l, inp.base)).map((l) => l.logIndex);
    const fromReceipt = receipt.filter((l) => isTransferOf(l, inp.base)).map((l) => l.logIndex);
    if (fromScan.join() !== fromReceipt.join()) {
      throw new FlowError(`base Transfers of tx ${tx} differ between the log scan and its receipt`);
    }
    const block = receipt[0]?.blockNumber;
    if (block === undefined) throw new FlowError(`swap tx ${tx} has an empty receipt`);
    const net = new Map<bigint, [bigint, bigint]>();
    const bump = (a: bigint, i: 0 | 1, v: bigint): void => {
      const x = net.get(a) ?? [0n, 0n];
      x[i] += v;
      net.set(a, x);
    };
    for (const l of receipt) {
      const i = isTransferOf(l, inp.base) ? 0 : isTransferOf(l, inp.quote) ? 1 : -1;
      if (i < 0) continue;
      const t = decodeTransfer(l);
      bump(addressToBigInt(t.from), i as 0 | 1, -t.value);
      bump(addressToBigInt(t.to), i as 0 | 1, t.value);
    }
    const window = inp.windowOf(block);
    for (const [a, [b, q]] of [...net].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      if (a === inp.pool || a === ZERO || (b === 0n && q === 0n)) continue;
      const f = of(a);
      if (b > 0n) f.swapBaseIn += b;
      if (b < 0n) f.swapBaseOut += -b;
      if (q > 0n) f.swapQuoteIn += q;
      if (q < 0n) f.swapQuoteOut += -q;
      if (b !== 0n) {
        const w = f.windows.get(window) ?? { buy: 0n, sell: 0n };
        if (b > 0n) w.buy += b;
        else w.sell += -b;
        f.windows.set(window, w);
      }
    }
  }

  // 2. Base Transfers outside swap txs: pool legs or transfers.
  for (const l of inp.logs) {
    if (!isTransferOf(l, inp.base) || swapTxs.has(l.transactionHash)) continue;
    const t = decodeTransfer(l);
    const from = addressToBigInt(t.from);
    const to = addressToBigInt(t.to);
    if (from === to || t.value === 0n) continue;
    if (from === inp.pool || to === inp.pool) {
      const other = from === inp.pool ? to : from;
      if (other !== ZERO) of(other).poolLegBase += from === inp.pool ? t.value : -t.value;
      continue;
    }
    if (from !== ZERO) of(from).xferOut += t.value;
    if (to !== ZERO) {
      const f = of(to);
      f.xferIn += t.value;
      if (inp.treasury.has(from)) f.fromTreasury += t.value;
    }
  }
  return flows;
}

export interface ExtractOptions extends ChunkOptions {
  /** Receipts fetched in parallel. Default 4. */
  readonly receiptConcurrency?: number;
  /**
   * Also scan this position manager's Increase/DecreaseLiquidity in the same requests
   * (the depth replay needs them; one scan serves both).
   */
  readonly positionManager?: bigint;
}

/**
 * Fetch and classify one pool's flows over (startBlock, endBlock]: one chunked scan of
 * pool events + base-token Transfers, then the full receipt of every swap tx.
 */
export async function extractFlows(
  rpc: EvmRpc,
  inp: Omit<FlowInputs, "logs" | "swapTxLogs">,
  range: EpochRange,
  opts: ExtractOptions = {},
): Promise<{ flows: Map<bigint, AddressFlows>; logs: RpcLog[]; swapTxs: number }> {
  const hex = (a: bigint): string => `0x${a.toString(16).padStart(40, "0")}`;
  const npm = opts.positionManager;
  const logs = await getLogsChunked(
    rpc,
    {
      address: npm === undefined ? [hex(inp.pool), hex(inp.base)] : [hex(inp.pool), hex(inp.base), hex(npm)],
      topics: [
        npm === undefined
          ? [TOPIC0.swap, TOPIC0.mint, TOPIC0.burn, TOPIC0.transfer]
          : [TOPIC0.swap, TOPIC0.mint, TOPIC0.burn, TOPIC0.transfer, TOPIC0.increaseLiquidity, TOPIC0.decreaseLiquidity],
      ],
      fromBlock: range.startBlock + 1,
      toBlock: range.endBlock,
    },
    opts,
  );
  const hashes = swapTxHashes(inp.pool, logs);
  const swapTxLogs = new Map<string, readonly RpcLog[]>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < hashes.length) {
      const h = hashes[next++]!;
      const r = await rpc.transactionReceipt(h);
      if (!r.status) throw new FlowError(`swap tx ${h} has a reverted receipt`);
      swapTxLogs.set(h, r.logs);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.receiptConcurrency ?? 4, hashes.length) }, worker));
  return { flows: classifyFlows({ ...inp, logs, swapTxLogs }), logs, swapTxs: hashes.length };
}
