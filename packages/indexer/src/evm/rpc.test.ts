import { describe, it, expect } from "vitest";
import { JsonRpcClient, EvmRpcError, hexToNumber, numberToHex } from "./rpc.js";
import type { FetchLike } from "../http.js";

function rpcResult(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
}

function recording(makeResponse: () => Response): {
  fetch: FetchLike;
  calls: { url: string; body: unknown }[];
} {
  const calls: { url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? "null")) });
    return makeResponse();
  };
  return { fetch, calls };
}

const URL = "https://eth-mainnet.example/key";

describe("JsonRpcClient request framing", () => {
  it("frames a JSON-RPC 2.0 POST and parses a hex result", async () => {
    const { fetch, calls } = recording(() => rpcResult("0x1"));
    const client = new JsonRpcClient({ url: URL, fetchImpl: fetch });

    expect(await client.chainId()).toBe(1);
    expect(calls[0]!.url).toBe(URL);
    expect(calls[0]!.body).toMatchObject({ jsonrpc: "2.0", method: "eth_chainId", params: [] });
  });

  it("blockNumber parses the hex height", async () => {
    const { fetch } = recording(() => rpcResult("0x10a"));
    const client = new JsonRpcClient({ url: URL, fetchImpl: fetch });
    expect(await client.blockNumber()).toBe(266);
  });

  it("finalizedBlockNumber reads the finalized block's number", async () => {
    const { fetch, calls } = recording(() => rpcResult({ number: "0x1234" }));
    const client = new JsonRpcClient({ url: URL, fetchImpl: fetch });
    expect(await client.finalizedBlockNumber()).toBe(0x1234);
    expect(calls[0]!.body).toMatchObject({
      method: "eth_getBlockByNumber",
      params: ["finalized", false],
    });
  });

  it("throws when the node returns no finalized block", async () => {
    const { fetch } = recording(() => rpcResult(null));
    const client = new JsonRpcClient({ url: URL, fetchImpl: fetch });
    await expect(client.finalizedBlockNumber()).rejects.toThrow(/finalized block/);
  });

  it("sends eth_getLogs with hex block bounds and parses logs", async () => {
    const log = {
      address: "0xABCDEF0000000000000000000000000000000001",
      topics: ["0xAAAA"],
      data: "0x00",
      blockNumber: "0x64",
      logIndex: "0x2",
      transactionHash: "0xdead",
    };
    const { fetch, calls } = recording(() => rpcResult([log]));
    const client = new JsonRpcClient({ url: URL, fetchImpl: fetch });

    const logs = await client.getLogs({ fromBlock: 100, toBlock: 200, topics: ["0xAAAA"] });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ address: "0xabcdef0000000000000000000000000000000001", blockNumber: 100, logIndex: 2 });
    expect(logs[0]!.topics[0]).toBe("0xaaaa"); // lowercased
    expect(calls[0]!.body).toMatchObject({
      method: "eth_getLogs",
      params: [{ fromBlock: "0x64", toBlock: "0xc8", topics: ["0xAAAA"] }],
    });
  });

  it("surfaces a JSON-RPC error object as a typed error with its code", async () => {
    const { fetch } = recording(
      () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "header not found" } }), { status: 200 }),
    );
    const client = new JsonRpcClient({ url: URL, fetchImpl: fetch });
    await expect(client.blockNumber()).rejects.toMatchObject({ name: "EvmRpcError", code: -32000 });
  });

  it("throws on an HTTP error with status + body", async () => {
    const { fetch } = recording(() => new Response("rate limited", { status: 429 }));
    const client = new JsonRpcClient({ url: URL, fetchImpl: fetch });
    await expect(client.blockNumber()).rejects.toMatchObject({ name: "EvmRpcError", code: 429 });
  });

  it("rejects a malformed log", async () => {
    const { fetch } = recording(() => rpcResult([{ address: "0x1" }]));
    const client = new JsonRpcClient({ url: URL, fetchImpl: fetch });
    await expect(client.getLogs({ fromBlock: 0, toBlock: 1 })).rejects.toThrow(/malformed log/);
  });

  it("requires a url", () => {
    expect(() => new JsonRpcClient({ url: "" })).toThrow(EvmRpcError);
  });
});

describe("hex helpers", () => {
  it("round-trips non-negative integers", () => {
    for (const n of [0, 1, 255, 266, 1_000_000]) expect(hexToNumber(numberToHex(n))).toBe(n);
  });
  it("rejects non-hex and unsafe quantities", () => {
    expect(() => hexToNumber("123")).toThrow();
    expect(() => hexToNumber("0xfffffffffffffffffff")).toThrow(/safe integer/);
    expect(() => numberToHex(-1)).toThrow();
  });
});
