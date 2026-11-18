// Registration commitments, byte-for-byte what the Midnight contract's `register` circuit
// records (packages/contracts/src/epoch_proof.compact):
//
//   walletCommit = persistentCommit<Vector<16, Uint<160>>>(slots, walletSalt)
//   termsCommit  = persistentCommit<Terms>(terms, termsSalt)
//
// where persistentCommit(v, r) = SHA-256(r || serialize(v)) with little-endian Uints.
// Mirrors @mmr/prover's commitWallets / commitTerms (cross-checked in the tests) but has
// no dependency on the Compact runtime, so it runs in the browser.

import { bytesToHex, hexToBytes, sha256, uintLE, concatBytes } from "./bytes.js";

export const WALLET_SLOTS = 16;
/** Every engagement runs exactly this many epochs (the contract enforces it, DD-35). */
export const CONTRACT_EPOCHS = 30;

export interface Terms {
  floorPriceP: bigint; // Uint<64>
  loanL0: bigint; // Uint<128>
  quoteStartQ0: bigint; // Uint<128>
  disposalD: bigint; // Uint<128>
  netSellS: bigint; // Uint<128>
  depthTarget: bigint; // Uint<128>
  roundtripSharePpm: bigint; // Uint<64>
  bandBps: number; // Uint<64>
  minUptimeBuckets: number; // Uint<64>
  epochsTotal: number; // Uint<64>, always CONTRACT_EPOCHS (30)
}

/** Active wallets → the committed 16-slot vector: sorted ascending, zero-padded. */
export function walletSlots(wallets: readonly string[]): bigint[] {
  if (wallets.length === 0) throw new Error("at least one wallet is required");
  if (wallets.length > WALLET_SLOTS) throw new Error(`at most ${WALLET_SLOTS} wallets`);
  const vals = wallets.map((w) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(w)) throw new Error(`not an address: ${w}`);
    const v = BigInt(w);
    if (v === 0n) throw new Error("the zero address is not allowed");
    return v;
  });
  vals.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (let i = 1; i < vals.length; i++) if (vals[i] === vals[i - 1]) throw new Error("duplicate wallet");
  return [...vals, ...new Array<bigint>(WALLET_SLOTS - vals.length).fill(0n)];
}

export async function walletCommit(wallets: readonly string[], walletSalt: Uint8Array): Promise<`0x${string}`> {
  if (walletSalt.length !== 32) throw new Error("walletSalt must be 32 bytes");
  const image = concatBytes(...walletSlots(wallets).map((s) => uintLE(s, 160)));
  return bytesToHex(await sha256(walletSalt, image));
}

export function assertTerms(t: Terms): void {
  const ints: Array<[keyof Terms, number]> = [
    ["bandBps", 64],
    ["minUptimeBuckets", 64],
    ["epochsTotal", 64],
  ];
  for (const [k] of ints) {
    const v = t[k] as number;
    if (!Number.isInteger(v) || v < 0) throw new Error(`${k} must be a non-negative integer`);
  }
  if (t.bandBps <= 0) throw new Error("bandBps must be positive");
  if (t.epochsTotal !== CONTRACT_EPOCHS) throw new Error(`engagements run ${CONTRACT_EPOCHS} epochs`);
}

export function termsImage(t: Terms): Uint8Array {
  assertTerms(t);
  return concatBytes(
    uintLE(t.floorPriceP, 64),
    uintLE(t.loanL0, 128),
    uintLE(t.quoteStartQ0, 128),
    uintLE(t.disposalD, 128),
    uintLE(t.netSellS, 128),
    uintLE(t.depthTarget, 128),
    uintLE(t.roundtripSharePpm, 64),
    uintLE(BigInt(t.bandBps), 64),
    uintLE(BigInt(t.minUptimeBuckets), 64),
    uintLE(BigInt(t.epochsTotal), 64),
  );
}

export async function termsCommit(t: Terms, termsSalt: Uint8Array): Promise<`0x${string}`> {
  if (termsSalt.length !== 32) throw new Error("termsSalt must be 32 bytes");
  return bytesToHex(await sha256(termsSalt, termsImage(t)));
}

/** Terms as JSON-safe strings (bigints as decimal strings). */
export type TermsJson = { [K in keyof Terms]: string };

export function termsToJson(t: Terms): TermsJson {
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, String(v)])) as TermsJson;
}

export function termsFromJson(j: TermsJson): Terms {
  const big = (k: keyof Terms) => {
    if (!/^\d+$/.test(j[k])) throw new Error(`bad ${k}`);
    return BigInt(j[k]);
  };
  const int = (k: keyof Terms) => {
    if (!/^\d+$/.test(j[k])) throw new Error(`bad ${k}`);
    return Number(j[k]);
  };
  const t: Terms = {
    floorPriceP: big("floorPriceP"),
    loanL0: big("loanL0"),
    quoteStartQ0: big("quoteStartQ0"),
    disposalD: big("disposalD"),
    netSellS: big("netSellS"),
    depthTarget: big("depthTarget"),
    roundtripSharePpm: big("roundtripSharePpm"),
    bandBps: int("bandBps"),
    minUptimeBuckets: int("minUptimeBuckets"),
    epochsTotal: int("epochsTotal"),
  };
  assertTerms(t);
  return t;
}

/** The public fingerprint of a registration: both commitments, hashed together. */
export async function registrationFingerprint(walletCommitHex: string, termsCommitHex: string): Promise<`0x${string}`> {
  return bytesToHex(await sha256(hexToBytes(walletCommitHex, 32), hexToBytes(termsCommitHex, 32)));
}
