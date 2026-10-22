// Minimal EVM JSON-RPC client (archive node).
//
// A boundary (code_standards): validates responses and throws typed errors; the
// transport (`fetch`) is injectable so the client is unit-tested with a fake and no
// network. Only the methods the indexer needs are exposed. Block numbers and log
// fields are hex quantities on the wire; this layer parses them to the project's
// numeric discipline (bigint for amounts, number for block heights).

import type { FetchLike } from "../http.js";

export interface RpcLog {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
  readonly blockNumber: number;
  readonly logIndex: number;
  readonly transactionHash: string;
}

export interface LogFilter {
  readonly address?: string | readonly string[];
  /** topic0..topicN; null = wildcard at that position. */
  readonly topics?: ReadonlyArray<string | readonly string[] | null>;
  readonly fromBlock: number;
  readonly toBlock: number;
}

export interface BlockHeader {
  readonly number: number;
  /** Unix seconds. */
  readonly timestamp: number;
  readonly hash: string;
}

export interface EvmRpc {
  /** eth_chainId. */
  chainId(): Promise<number>;
  /** eth_blockNumber (latest). */
  blockNumber(): Promise<number>;
  /** eth_getBlockByNumber("finalized") -> its number. */
  finalizedBlockNumber(): Promise<number>;
  /** eth_getBlockByNumber(n, false) -> number, timestamp, hash. */
  blockHeader(n: number): Promise<BlockHeader>;
  /** eth_getLogs. */
  getLogs(filter: LogFilter): Promise<RpcLog[]>;
  /** eth_call at a fixed block (hex-encoded return data). */
  call(to: string, data: string, block: number): Promise<string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class EvmRpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "EvmRpcError";
  }
}

interface JsonRpcConfig {
  readonly url: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchLike;
}

export class JsonRpcClient implements EvmRpc {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private id = 0;

  constructor(cfg: JsonRpcConfig) {
    if (!cfg.url || cfg.url.trim() === "") throw new EvmRpcError("missing RPC url");
    const fetchImpl = cfg.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchImpl) throw new EvmRpcError("no fetch implementation available");
    this.url = cfg.url;
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = fetchImpl;
  }

  async chainId(): Promise<number> {
    return hexToNumber(await this.request<string>("eth_chainId", []));
  }

  async blockNumber(): Promise<number> {
    return hexToNumber(await this.request<string>("eth_blockNumber", []));
  }

  async finalizedBlockNumber(): Promise<number> {
    const block = await this.request<{ number?: string } | null>("eth_getBlockByNumber", [
      "finalized",
      false,
    ]);
    if (!block || typeof block.number !== "string") {
      throw new EvmRpcError("node did not return a finalized block");
    }
    return hexToNumber(block.number);
  }

  async blockHeader(n: number): Promise<BlockHeader> {
    const block = await this.request<{ number?: unknown; timestamp?: unknown; hash?: unknown } | null>(
      "eth_getBlockByNumber",
      [numberToHex(n), false],
    );
    if (
      !block ||
      typeof block.number !== "string" ||
      typeof block.timestamp !== "string" ||
      typeof block.hash !== "string"
    ) {
      throw new EvmRpcError(`node did not return block ${n}`);
    }
    const header = {
      number: hexToNumber(block.number),
      timestamp: hexToNumber(block.timestamp),
      hash: block.hash.toLowerCase(),
    };
    if (header.number !== n) throw new EvmRpcError(`asked for block ${n}, node returned ${header.number}`);
    return header;
  }

  async getLogs(filter: LogFilter): Promise<RpcLog[]> {
    const params = [
      {
        fromBlock: numberToHex(filter.fromBlock),
        toBlock: numberToHex(filter.toBlock),
        ...(filter.address === undefined ? {} : { address: filter.address }),
        ...(filter.topics === undefined ? {} : { topics: filter.topics }),
      },
    ];
    const raw = await this.request<unknown>("eth_getLogs", params);
    if (!Array.isArray(raw)) throw new EvmRpcError("eth_getLogs did not return an array");
    return raw.map(parseLog);
  }

  async call(to: string, data: string, block: number): Promise<string> {
    return this.request<string>("eth_call", [{ to, data }, numberToHex(block)]);
  }

  private async request<T>(method: string, params: unknown[]): Promise<T> {
    const body = JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new EvmRpcError(`${method} timed out after ${this.timeoutMs}ms`);
      }
      throw new EvmRpcError(`${method} request failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    if (!res.ok) throw new EvmRpcError(`${method} HTTP ${res.status}`, res.status, text);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new EvmRpcError(`${method} response was not JSON`, undefined, text);
    }
    const env = parsed as { error?: { code?: number; message?: string }; result?: unknown };
    if (env.error) {
      throw new EvmRpcError(`${method}: ${env.error.message ?? "rpc error"}`, env.error.code);
    }
    if (!("result" in env)) throw new EvmRpcError(`${method} response had no result`);
    return env.result as T;
  }
}

function parseLog(raw: unknown): RpcLog {
  const l = raw as {
    address?: unknown;
    topics?: unknown;
    data?: unknown;
    blockNumber?: unknown;
    logIndex?: unknown;
    transactionHash?: unknown;
  };
  if (
    typeof l.address !== "string" ||
    !Array.isArray(l.topics) ||
    typeof l.data !== "string" ||
    typeof l.blockNumber !== "string" ||
    typeof l.logIndex !== "string" ||
    typeof l.transactionHash !== "string"
  ) {
    throw new EvmRpcError("malformed log in eth_getLogs response");
  }
  return {
    address: l.address.toLowerCase(),
    topics: l.topics.map((t) => {
      if (typeof t !== "string") throw new EvmRpcError("malformed log topic");
      return t.toLowerCase();
    }),
    data: l.data,
    blockNumber: hexToNumber(l.blockNumber),
    logIndex: hexToNumber(l.logIndex),
    transactionHash: l.transactionHash,
  };
}

export function hexToNumber(hex: string): number {
  if (!/^0x[0-9a-fA-F]+$/.test(hex)) throw new EvmRpcError(`not a hex quantity: ${hex}`);
  const n = Number.parseInt(hex, 16);
  if (!Number.isSafeInteger(n)) throw new EvmRpcError(`hex quantity exceeds safe integer: ${hex}`);
  return n;
}

export function numberToHex(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new EvmRpcError(`not a non-negative integer: ${n}`);
  return `0x${n.toString(16)}`;
}
