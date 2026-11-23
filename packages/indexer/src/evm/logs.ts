// eth_getLogs over a block range in fixed-size chunks (DD-22 context: the Free-tier
// key allows at most 10 blocks per request). Rate limits are retried with backoff by
// JsonRpcClient; chunks run with bounded concurrency. A chunk the provider refuses for its
// span or result size is split in half until it is accepted. Output is sorted by
// (blockNumber, logIndex), so it is independent of chunking, splitting and scheduling.

import { isRangeRejection, type EvmRpc, type LogFilter, type RpcLog } from "./rpc.js";

export interface ChunkOptions {
  /** Blocks per request (inclusive span). Default 10. */
  readonly chunkBlocks?: number;
  /** Requests in flight. Default 4. */
  readonly concurrency?: number;
  /** Called after each finished chunk (done, total). */
  readonly onProgress?: (done: number, total: number) => void;
}

export async function getLogsChunked(
  rpc: EvmRpc,
  filter: LogFilter,
  opts: ChunkOptions = {},
): Promise<RpcLog[]> {
  const span = opts.chunkBlocks ?? 10;
  const concurrency = opts.concurrency ?? 4;
  if (!Number.isInteger(span) || span < 1) throw new Error(`chunkBlocks must be a positive integer, got ${span}`);
  if (filter.toBlock < filter.fromBlock) return [];

  const chunks: [number, number][] = [];
  for (let from = filter.fromBlock; from <= filter.toBlock; from += span) {
    chunks.push([from, Math.min(from + span - 1, filter.toBlock)]);
  }
  const results: RpcLog[][] = new Array(chunks.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < chunks.length) {
      const i = next++;
      const [fromBlock, toBlock] = chunks[i]!;
      results[i] = await getLogsSplitting(rpc, filter, fromBlock, toBlock);
      opts.onProgress?.(++done, chunks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));

  const logs = results.flat();
  for (const l of logs) {
    if (l.blockNumber < filter.fromBlock || l.blockNumber > filter.toBlock) {
      throw new Error(`log at block ${l.blockNumber} outside the requested range`);
    }
  }
  return logs.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}

/** One chunk; halved (recursively) while the provider rejects its span or result size. */
async function getLogsSplitting(rpc: EvmRpc, filter: LogFilter, fromBlock: number, toBlock: number): Promise<RpcLog[]> {
  try {
    return await rpc.getLogs({ ...filter, fromBlock, toBlock });
  } catch (err) {
    if (fromBlock >= toBlock || !isRangeRejection(err)) throw err;
    const mid = Math.floor((fromBlock + toBlock) / 2);
    const left = await getLogsSplitting(rpc, filter, fromBlock, mid);
    const right = await getLogsSplitting(rpc, filter, mid + 1, toBlock);
    return [...left, ...right];
  }
}
