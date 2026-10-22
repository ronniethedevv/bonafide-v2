import { describe, it, expect } from "vitest";
import { classifyFlows, swapTxHashes, FlowError, type FlowInputs } from "./flows.js";
import { TOPIC0 } from "./abi.js";
import type { RpcLog } from "./rpc.js";

const POOL = 0x900n;
const BASE = 0xb00n;
const QUOTE = 0xc00n;
const MM = 0x51c7n; // inventory contract
const EXEC = 0x83d5n; // executor / router that holds nothing
const USER = 0x34aen;
const TREASURY = 0x7e5n;
const CEX = 0xcecn;

const addr = (a: bigint): string => `0x${a.toString(16).padStart(40, "0")}`;
const topicAddr = (a: bigint): string => `0x${a.toString(16).padStart(64, "0")}`;
let logIndex = 0;
const transfer = (tx: string, block: number, token: bigint, from: bigint, to: bigint, value: bigint): RpcLog => ({
  address: addr(token),
  topics: [TOPIC0.transfer, topicAddr(from), topicAddr(to)],
  data: `0x${value.toString(16).padStart(64, "0")}`,
  blockNumber: block,
  logIndex: logIndex++,
  transactionHash: tx,
});
const swap = (tx: string, block: number): RpcLog => ({
  address: addr(POOL),
  topics: [TOPIC0.swap, topicAddr(EXEC), topicAddr(MM)],
  data: `0x${"0".repeat(64 * 5)}`,
  blockNumber: block,
  logIndex: logIndex++,
  transactionHash: tx,
});

function scenario() {
  logIndex = 0;
  // tx a (block 10, window 0): MM sells 5 base for 100 quote through the executor:
  //   MM -> EXEC 5 base, EXEC -> POOL 5 base, POOL -> MM 100 quote
  const a = [transfer("0xa", 10, BASE, MM, EXEC, 5n), transfer("0xa", 10, BASE, EXEC, POOL, 5n), transfer("0xa", 10, QUOTE, POOL, MM, 100n), swap("0xa", 10)];
  // tx b (block 20, window 1): USER buys 2 base, paying quote via a router that wraps (the
  // router pays the pool from its own balance; USER's quote leg is native, invisible)
  const b = [transfer("0xb", 20, QUOTE, EXEC, POOL, 41n), transfer("0xb", 20, BASE, POOL, USER, 2n), swap("0xb", 20)];
  // tx c: treasury funds MM with 50 base (the loan); tx d: MM sends 7 base to a CEX
  const c = [transfer("0xc", 30, BASE, TREASURY, MM, 50n)];
  const d = [transfer("0xd", 31, BASE, MM, CEX, 7n)];
  // tx e: MM deposits 9 base as LP (pool counterparty, no Swap); tx f: collects 1 back
  const e = [transfer("0xe", 32, BASE, MM, POOL, 9n)];
  const f = [transfer("0xf", 33, BASE, POOL, MM, 1n)];
  const all = [...a, ...b, ...c, ...d, ...e, ...f];
  const scan = all.filter((l) => l.address === addr(BASE) || l.address === addr(POOL));
  const inputs: FlowInputs = {
    pool: POOL,
    base: BASE,
    quote: QUOTE,
    treasury: new Set([TREASURY]),
    logs: scan,
    swapTxLogs: new Map([["0xa", a], ["0xb", b]]),
    windowOf: (block) => (block < 15 ? 0 : 1),
  };
  return inputs;
}

describe("classifyFlows (DD-22 net token flow)", () => {
  it("credits a swap to the address whose balances moved, not the executor", () => {
    const flows = classifyFlows(scenario());
    const mm = flows.get(MM)!;
    expect([mm.swapBaseOut, mm.swapQuoteIn, mm.swapBaseIn, mm.swapQuoteOut]).toEqual([5n, 100n, 0n, 0n]);
    expect(mm.windows.get(0)).toEqual({ buy: 0n, sell: 5n });
    // the executor passed 5 base through: nets to zero, gets nothing
    expect(flows.get(EXEC)?.swapBaseOut ?? 0n).toBe(0n);
    // the router paid quote on the user's behalf: it shows as the router's quote outflow
    expect(flows.get(EXEC)!.swapQuoteOut).toBe(41n);
    expect(flows.get(POOL)).toBeUndefined();
  });

  it("a native-quote buyer gets its base leg only", () => {
    const user = classifyFlows(scenario()).get(USER)!;
    expect([user.swapBaseIn, user.swapQuoteOut]).toEqual([2n, 0n]);
    expect(user.windows.get(1)).toEqual({ buy: 2n, sell: 0n });
  });

  it("separates transfers, treasury inflows and pool legs", () => {
    const mm = classifyFlows(scenario()).get(MM)!;
    expect([mm.xferIn, mm.fromTreasury, mm.xferOut]).toEqual([50n, 50n, 7n]);
    expect(mm.poolLegBase).toBe(-8n); // −9 deposit + 1 collected
    expect(classifyFlows(scenario()).get(CEX)!.xferIn).toBe(7n);
  });

  it("conserves base for every address: Δbalance = swap net + pool legs + transfers", () => {
    const inp = scenario();
    const flows = classifyFlows(inp);
    const delta = new Map<bigint, bigint>();
    const all = [...inp.logs, ...[...inp.swapTxLogs.values()].flat()];
    const seen = new Set<string>();
    for (const l of all) {
      const k = `${l.transactionHash}:${l.logIndex}`;
      if (seen.has(k) || l.address !== addr(BASE) || l.topics[0] !== TOPIC0.transfer) continue;
      seen.add(k);
      const [from, to, v] = [BigInt(l.topics[1]!), BigInt(l.topics[2]!), BigInt(l.data)];
      delta.set(from, (delta.get(from) ?? 0n) - v);
      delta.set(to, (delta.get(to) ?? 0n) + v);
    }
    for (const [a, f] of flows) {
      const explained = f.swapBaseIn - f.swapBaseOut + f.poolLegBase + f.xferIn - f.xferOut;
      expect(explained).toBe(delta.get(a) ?? 0n);
    }
  });

  it("fails loudly on a missing receipt or a scan/receipt mismatch", () => {
    const inp = scenario();
    expect(() => classifyFlows({ ...inp, swapTxLogs: new Map([["0xa", inp.swapTxLogs.get("0xa")!]]) })).toThrow(/missing receipt/);
    const short = new Map(inp.swapTxLogs);
    short.set("0xa", inp.swapTxLogs.get("0xa")!.slice(1));
    expect(() => classifyFlows({ ...inp, swapTxLogs: short })).toThrow(FlowError);
  });

  it("swapTxHashes lists only txs with a Swap on this pool", () => {
    expect(swapTxHashes(POOL, scenario().logs)).toEqual(["0xa", "0xb"]);
  });
});
