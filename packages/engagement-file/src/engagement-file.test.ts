import { describe, expect, it } from "vitest";
import { CompactHasher } from "@mmr/merkle";
import { buildWalletVector, commitTerms, commitWallets, type EngagementTerms } from "@mmr/prover";
import {
  acceptanceMessage,
  bytesToHex,
  contexts,
  hexToBytes,
  inboxKeyFromSignature,
  isEnvelope,
  newOpening,
  open,
  openFile,
  registrationFingerprint,
  seal,
  sealFile,
  termsCommit,
  termsFromJson,
  termsToJson,
  walletCommit,
  walletSlots,
  type EngagementOpening,
  type Terms,
} from "./index.js";

const TERMS: Terms = {
  floorPriceP: 1_850_000_000n,
  loanL0: 2_000_000_000_000n,
  quoteStartQ0: 0n,
  disposalD: 2_000_000_000_000n,
  netSellS: 0n,
  depthTarget: 250_000_000_000n,
  roundtripSharePpm: 600_000n,
  bandBps: 100,
  minUptimeBuckets: 44,
  epochsTotal: 30,
};
const WALLETS = ["0x00000000000000000000000000000000000000f2", "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01", "0x0000000000000000000000000000000000000010"];
const salt = (b: number) => new Uint8Array(32).fill(b);

describe("commitments are byte-exact with @mmr/prover (and so with the Compact contract)", () => {
  it("walletCommit matches commitWallets with CompactHasher", async () => {
    const hasher = new CompactHasher();
    const vector = buildWalletVector(WALLETS.map((w) => BigInt(w)));
    expect(await walletCommit(WALLETS, salt(7))).toBe(bytesToHex(commitWallets(hasher, vector, salt(7))));
    expect(walletSlots(WALLETS)).toEqual(vector.slots);
  });

  it("termsCommit matches commitTerms with CompactHasher", async () => {
    const hasher = new CompactHasher();
    const proverTerms: EngagementTerms = { ...TERMS };
    expect(await termsCommit(TERMS, salt(0x7e))).toBe(bytesToHex(commitTerms(hasher, proverTerms, salt(0x7e))));
  });

  it("rejects bad wallets and out-of-range terms", async () => {
    expect(() => walletSlots([])).toThrow();
    expect(() => walletSlots(["0x1234"])).toThrow();
    expect(() => walletSlots([WALLETS[0]!, WALLETS[0]!.toUpperCase().replace("0X", "0x")])).toThrow("duplicate");
    expect(() => walletSlots(["0x0000000000000000000000000000000000000000"])).toThrow();
    await expect(termsCommit({ ...TERMS, epochsTotal: 91 }, salt(1))).rejects.toThrow();
    await expect(termsCommit({ ...TERMS, floorPriceP: 1n << 64n }, salt(1))).rejects.toThrow();
  });

  it("terms survive a JSON round-trip", () => {
    expect(termsFromJson(termsToJson(TERMS))).toEqual(TERMS);
  });

  it("fingerprint is order-sensitive and deterministic", async () => {
    const a = `0x${"11".repeat(32)}`;
    const b = `0x${"22".repeat(32)}`;
    expect(await registrationFingerprint(a, b)).toBe(await registrationFingerprint(a, b));
    expect(await registrationFingerprint(a, b)).not.toBe(await registrationFingerprint(b, a));
  });
});

async function opening(): Promise<EngagementOpening> {
  return newOpening({
    pool: { chain: "Base", address: "0xd0b53d9277642d899df5c87a3966a349a798f224", pair: "WETH / USDC" },
    client: { name: "Nova", address: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" },
    label: "Nova WETH book",
    wallets: WALLETS,
    terms: TERMS,
    human: { loan: "2000000" },
  });
}

describe("engagement file", () => {
  it("fresh openings get unique secrets and verifiable commitments", async () => {
    const a = await opening();
    const b = await opening();
    expect(a.secrets.engagementSecret).not.toBe(b.secrets.engagementSecret);
    expect(a.commitments.termsCommit).not.toBe(b.commitments.termsCommit);
    expect(await termsCommit(TERMS, hexToBytes(a.secrets.termsSalt))).toBe(a.commitments.termsCommit);
  });

  it("round-trips with the right passphrase and keeps nothing private in clear", async () => {
    const o = await opening();
    const f = await sealFile(o, "correct horse battery staple", 1_000);
    const raw = JSON.stringify(f);
    for (const secret of [o.secrets.walletSalt, o.secrets.termsSalt, o.secrets.engagementSecret, "WETH", "Nova", WALLETS[1]!.toLowerCase()]) {
      expect(raw).not.toContain(secret);
    }
    expect(await openFile(f, "correct horse battery staple")).toEqual(o);
  });

  it("refuses a wrong passphrase, a short passphrase, and any tampering", async () => {
    const o = await opening();
    const f = await sealFile(o, "correct horse battery staple", 1_000);
    await expect(openFile(f, "wrong horse battery staple")).rejects.toThrow("wrong passphrase");
    await expect(sealFile(o, "short", 1_000)).rejects.toThrow("at least 12");
    const swappedHint = { ...f, hint: { ...f.hint, termsCommit: `0x${"00".repeat(32)}` } };
    await expect(openFile(swappedHint, "correct horse battery staple")).rejects.toThrow();
    const ct = f.ciphertext;
    const flipped = { ...f, ciphertext: (ct[0] === "A" ? "B" : "A") + ct.slice(1) };
    await expect(openFile(flipped, "correct horse battery staple")).rejects.toThrow();
  });

  it("won't seal an opening whose commitments don't match its contents", async () => {
    const o = await opening();
    const lie = { ...o, terms: { ...o.terms, depthTarget: "1" } };
    await expect(sealFile(lie, "correct horse battery staple", 1_000)).rejects.toThrow("do not match");
  });
});

describe("sealed channel", () => {
  // A stand-in for a wallet's 65-byte signature over INBOX_KEY_MESSAGE.
  const SIG = `0x${"5a".repeat(64)}1b`;

  it("derives the same inbox key from the same signature", async () => {
    const a = await inboxKeyFromSignature(SIG);
    const b = await inboxKeyFromSignature(SIG);
    expect(a.publicKey).toBe(b.publicKey);
    expect(a.publicKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect((await inboxKeyFromSignature(`0x${"5b".repeat(64)}1b`)).publicKey).not.toBe(a.publicKey);
  });

  it("only the recipient opens it, and only in the right context", async () => {
    const client = await inboxKeyFromSignature(SIG);
    const other = await inboxKeyFromSignature(`0x${"77".repeat(64)}1c`);
    const ctx = contexts.terms(`0x${"aa".repeat(32)}`, `0x${"bb".repeat(32)}`);
    const env = await seal(JSON.stringify({ hello: "terms" }), client.publicKey, ctx);
    expect(isEnvelope(env)).toBe(true);
    expect(JSON.stringify(env)).not.toContain("terms\"");
    expect(JSON.parse(await open(env, client.privateKey, ctx))).toEqual({ hello: "terms" });
    await expect(open(env, other.privateKey, ctx)).rejects.toThrow("can't be opened");
    await expect(open(env, client.privateKey, contexts.epoch("rec_x", 1))).rejects.toThrow("can't be opened");
  });

  it("each seal is fresh (new ephemeral key and IV)", async () => {
    const client = await inboxKeyFromSignature(SIG);
    const a = await seal("x", client.publicKey, "c");
    const b = await seal("x", client.publicKey, "c");
    expect(a.epk).not.toBe(b.epk);
    expect(a.ct).not.toBe(b.ct);
  });

  it("acceptance message names the engagement and both commitments", () => {
    const m = acceptanceMessage({ registrationId: "rec_1", walletCommit: "0xaa", termsCommit: "0xbb" });
    expect(m).toContain("Engagement: rec_1");
    expect(m).toContain("Wallet commitment: 0xaa");
    expect(m).toContain("Terms commitment: 0xbb");
  });
});
