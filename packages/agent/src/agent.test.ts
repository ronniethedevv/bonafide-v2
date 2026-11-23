import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  contexts,
  inboxKeyFromSignature,
  isEpochFigures,
  newOpening,
  open,
  sealFile,
  type EngagementOpening,
  type SealedEnvelope,
} from "@mmr/engagement-file";
import { DEFAULT_CONFIG, type AddressActivity } from "@mmr/indexer";
import { AgentApi, type ServerEngagement } from "./api.js";
import { AgentHome } from "./home.js";
import { runEpoch } from "./run.js";
import { replaySource } from "./sources.js";

const POOL = "0x00000000000000000000000000000000000abcde";
const MM_WALLET = "0x0000000000000000000000000000000000000010";
const OTHER = "0x0000000000000000000000000000000000000099";
const PASS = "correct horse battery staple";
const J = (x: unknown) => JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v));

function activity(addr: string, depth: bigint): AddressActivity {
  return {
    addr: BigInt(addr), isProtocol: false, baseStart: 1000n, baseEnd: 800n, quoteEnd: 0n, lpBase: 300n, lpQuote: 0n,
    xferIn: 0n, xferOut: 0n, fromTreasury: 0n, swapBaseIn: 50n, swapBaseOut: 50n, swapQuoteIn: 0n, swapQuoteOut: 0n,
    depthBuckets: Array.from({ length: 48 }, (_, b) => ({ bucket: b, perBand: DEFAULT_CONFIG.bandsBps.map((bandBps) => ({ bandBps, minBid: depth, minAsk: depth })) })),
    flowWindows: [{ window: 0, buy: 50n, sell: 40n }],
    lpFirstActiveTs: 1,
  };
}

function writeEpoch(dir: string, epoch: number, pool = POOL) {
  const range = { epoch, startBlock: 1000 * epoch, endBlock: 1000 * epoch + 999, endBlockHash: `0x${epoch.toString(16).padStart(64, "0")}`, startTs: 1_790_000_000 + epoch * 86_400, endTs: 1_790_086_400 + epoch * 86_400 };
  writeFileSync(join(dir, `epoch-${epoch}.json`), J({ pool: { pool }, epoch, range, activities: [activity(MM_WALLET, 120n), activity(OTHER, 5n)] }));
}

/** An in-memory stand-in for the agent API, behind the real HTTP client. */
function fakeServer(reg: ServerEngagement) {
  const figures = new Map<number, SealedEnvelope>();
  const fetchImpl = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const ok = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body });
    if (init?.headers?.Authorization !== "Bearer mmra_test") return ok({ error: "Unknown or revoked agent token." }, 401);
    const path = url.replace(/^.*\/api\/agent\/v1/, "");
    if (path === "/engagements") return ok({ engagements: [reg] });
    const m = /^\/engagements\/([^/]+)\/epochs\/(\d+)(\/figures)?$/.exec(path);
    if (m && m[1] === reg.id) {
      const epoch = Number(m[2]);
      if (!m[3]) {
        const had = reg.epochs.some((e) => e.epoch === epoch);
        if (!had) reg.epochs.push({ epoch, phase: "captured" });
        return ok({ ok: true, changed: !had });
      }
      if (figures.has(epoch)) return ok({ error: "Figures for this epoch were already shared." }, 409);
      figures.set(epoch, JSON.parse(init!.body!).envelope);
      return ok({ ok: true });
    }
    return ok({ error: "Not found." }, 404);
  };
  return { api: new AgentApi("http://test", "mmra_test", fetchImpl), figures };
}

let home: AgentHome;
let replayDir: string;
let opening: EngagementOpening;
let reg: ServerEngagement;
let clientKey: Awaited<ReturnType<typeof inboxKeyFromSignature>>;

beforeEach(async () => {
  const root = mkdtempSync(join(tmpdir(), "mmr-agent-"));
  home = new AgentHome(join(root, "home"));
  replayDir = join(root, "replay");
  mkdirSync(replayDir);
  opening = await newOpening({
    pool: { chain: "Base", address: POOL, pair: "TKN / USDC" },
    client: { address: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" },
    wallets: [MM_WALLET],
    terms: { floorPriceP: 0n, loanL0: 1000n, quoteStartQ0: 0n, disposalD: 1000n, netSellS: 0n, depthTarget: 100n, roundtripSharePpm: 600_000n, bandBps: 100, minUptimeBuckets: 44, epochsTotal: 30, pool: BigInt(POOL) },
    human: {},
  });
  home.saveEngagementFile("rec_abc", await sealFile(opening, PASS, 1_000));
  clientKey = await inboxKeyFromSignature(`0x${"5a".repeat(64)}1b`);
  reg = { id: "rec_abc", status: "accepted", walletCommit: opening.commitments.walletCommit, termsCommit: opening.commitments.termsCommit, clientName: "Nova", clientInboxKey: clientKey.publicKey, epochs: [] };
});

describe("agent daily step", () => {
  it("captures from public activity, reports the phase, and seals figures only the client can read", async () => {
    writeEpoch(replayDir, 1);
    const { api, figures } = fakeServer(reg);
    const r = await runEpoch({ api, home, registrationId: "rec_abc", epoch: 1, source: replaySource(replayDir), passphrase: PASS });
    expect(r).toMatchObject({ epoch: 1, reused: false, phaseChanged: true, figuresPosted: true, met: true, bucketsAtTarget: 48 });
    expect(reg.epochs).toEqual([{ epoch: 1, phase: "captured" }]);
    const f = JSON.parse(await open(figures.get(1)!, clientKey.privateKey, contexts.epoch("rec_abc", 1)));
    expect(isEpochFigures(f) && f.epoch === 1 && f.bucketsAtTarget === 48 && f.checks.custody).toBe(true);
    // Only the MM's committed wallet counted: the other address's tiny depth is ignored.
    expect(f.roundTripPct).toBe(Math.round((40 / 90) * 100));
  });

  it("is safe to re-run and chains epochs in order", async () => {
    writeEpoch(replayDir, 1);
    writeEpoch(replayDir, 2);
    writeEpoch(replayDir, 3);
    const { api } = fakeServer(reg);
    const args = { api, home, registrationId: "rec_abc", source: replaySource(replayDir), passphrase: PASS };
    await runEpoch({ ...args, epoch: 1 });
    expect(await runEpoch({ ...args, epoch: 1 })).toMatchObject({ reused: true, phaseChanged: false, figuresPosted: false });
    await expect(runEpoch({ ...args, epoch: 3 })).rejects.toThrow("epoch 2 not yet captured");
    expect((await runEpoch({ ...args, epoch: 2 })).reused).toBe(false);
  });

  it("refuses to work on what it shouldn't", async () => {
    writeEpoch(replayDir, 1);
    const args = { home, registrationId: "rec_abc", epoch: 1, source: replaySource(replayDir), passphrase: PASS };
    await expect(runEpoch({ ...args, api: fakeServer({ ...reg, status: "proposed" }).api })).rejects.toThrow("must accept it first");
    await expect(runEpoch({ ...args, api: fakeServer({ ...reg, clientInboxKey: null }).api })).rejects.toThrow("private inbox");
    await expect(runEpoch({ ...args, api: fakeServer({ ...reg, termsCommit: `0x${"00".repeat(32)}` }).api })).rejects.toThrow("doesn't match");
    await expect(runEpoch({ ...args, api: fakeServer(reg).api, passphrase: "wrong passphrase!!" })).rejects.toThrow("wrong passphrase");
    await expect(runEpoch({ ...args, api: fakeServer(reg).api, epoch: 31 })).rejects.toThrow("30 epochs");
    const other = join(replayDir, "other");
    mkdirSync(other);
    writeEpoch(other, 1, "0x00000000000000000000000000000000000fffff");
    await expect(runEpoch({ ...args, api: fakeServer(reg).api, source: replaySource(other) })).rejects.toThrow("activity is for pool");
    await expect(runEpoch({ ...args, api: new AgentApi("http://test", "mmra_wrong", fakeServer(reg).api["fetchImpl" as never]) })).rejects.toThrow("revoked");
  });
});
