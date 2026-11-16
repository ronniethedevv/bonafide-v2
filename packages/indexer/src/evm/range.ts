// Pin an EpochRange to real blocks (range rule, UNIT3_CHAINPROVIDER.md):
//   startBlock = last block with timestamp ≤ startTs
//   endBlock   = last block with timestamp ≤ endTs
// so the state at the epoch's start/end is the state after those blocks, and epochs
// tile: epoch e's endBlock is epoch e+1's startBlock. State reads for the start/end of
// the epoch are at startBlock/endBlock; event scans cover (startBlock, endBlock].

import type { EpochRange } from "../provider.js";
import type { BlockHeader, EvmRpc } from "./rpc.js";
import { lastBlockAtOrBefore } from "./price.js";

export class EpochRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EpochRangeError";
  }
}

export async function resolveEpochRange(
  rpc: EvmRpc,
  epoch: number,
  startTs: number,
  endTs: number,
): Promise<EpochRange> {
  if (!Number.isInteger(startTs) || !Number.isInteger(endTs) || endTs <= startTs) {
    throw new EpochRangeError(`bad epoch window [${startTs}, ${endTs}]`);
  }
  const headers = new Map<number, Promise<BlockHeader>>();
  const header = (n: number): Promise<BlockHeader> => {
    let h = headers.get(n);
    if (!h) headers.set(n, (h = rpc.blockHeader(n)));
    return h;
  };
  const finalized = await rpc.finalizedBlockNumber();
  // The epoch is only pinnable once a finalized block lies after its end: otherwise the
  // last block ≤ endTs could still change.
  if ((await header(finalized)).timestamp <= endTs) {
    throw new EpochRangeError(`epoch ${epoch} ends at ${endTs}, after the finalized head`);
  }
  const endBlock = await lastBlockAtOrBefore(header, endTs, 0, finalized);
  const startBlock = await lastBlockAtOrBefore(header, startTs, 0, endBlock ?? 0);
  if (endBlock === null || startBlock === null) {
    throw new EpochRangeError(`epoch ${epoch} starts before the chain's first block`);
  }
  return {
    epoch,
    startBlock,
    endBlock,
    endBlockHash: (await header(endBlock)).hash,
    startTs,
    endTs,
  };
}

/**
 * Bucket / flow-window lookup for blocks in (startBlock, endBlock]: window k holds the
 * blocks after the last block ≤ startTs + k·step up to the last block ≤ startTs +
 * (k+1)·step (the range rule applied to each boundary). Returns windowOf(block).
 */
export async function windowIndex(
  header: (n: number) => Promise<BlockHeader>,
  range: EpochRange,
  stepSeconds: number,
): Promise<(block: number) => number> {
  const count = Math.ceil((range.endTs - range.startTs) / stepSeconds);
  const bounds: number[] = [];
  let lo = range.startBlock;
  for (let k = 1; k < count; k++) {
    const b = await lastBlockAtOrBefore(header, range.startTs + k * stepSeconds, lo, range.endBlock);
    bounds.push(b ?? range.startBlock);
    if (b !== null) lo = b;
  }
  return (block: number): number => {
    if (block <= range.startBlock || block > range.endBlock) {
      throw new EpochRangeError(`block ${block} is outside (${range.startBlock}, ${range.endBlock}]`);
    }
    let lo = 0;
    let hi = bounds.length; // first boundary ≥ block
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bounds[mid]! < block) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}
