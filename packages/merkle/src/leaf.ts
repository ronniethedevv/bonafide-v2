// Leaf schema for the per-pool indexed Merkle tree.
//
// Mirrors the "Data layer" leaf table in the product spec. One leaf per indexed
// address in a pool. Signed quantities are split into in/out pairs because the
// circuit (Compact) has only unsigned integers — never pre-subtract.

import { assertUint, BITS, encodeUint, formatAddr } from "./uint.js";
import { type Digest, type Hasher, DIGEST_BYTES } from "./hash.js";

/** Unsigned per-address economic metrics for one epoch. All Uint<128>. */
export interface LeafMetrics {
  /** Client-token balance at epoch start / end. */
  baseStart: bigint;
  baseEnd: bigint;
  /** Quote balance at end (native ETH counts when the quote is WETH). */
  quoteEnd: bigint;
  /** Tokens + uncollected fees in LP positions the address owns, at end. */
  lpBase: bigint;
  lpQuote: bigint;
  /** Client-token transfers outside pool flows, at amounts actually emitted. */
  xferIn: bigint;
  xferOut: bigint;
  /** Tokens received from the client's registered treasury. */
  fromTreasury: bigint;
  /** Client tokens bought / sold through swaps. */
  swapBaseIn: bigint;
  swapBaseOut: bigint;
  /** Quote received / paid in swaps. */
  swapQuoteIn: bigint;
  swapQuoteOut: bigint;
}

export interface Leaf {
  /** Sort key — the indexed address. Uint<160>. */
  addr: bigint;
  /** Next address in the address-sorted linked list; 0n marks the list tail. */
  nextAddr: bigint;
  /** Pool / router / position-manager — can never join a wallet set. */
  isProtocol: boolean;
  metrics: LeafMetrics;
  /** Commitment to min bid/ask depth per band (50/100/200/500 bps) per bucket. */
  depthRoot: Digest;
  /** Commitment to buy/sell amounts per window (round-trip checks). */
  flowRoot: Digest;
}

const METRIC_FIELDS: readonly (keyof LeafMetrics)[] = [
  "baseStart",
  "baseEnd",
  "quoteEnd",
  "lpBase",
  "lpQuote",
  "xferIn",
  "xferOut",
  "fromTreasury",
  "swapBaseIn",
  "swapBaseOut",
  "swapQuoteIn",
  "swapQuoteOut",
];

function assertBytes32(b: Digest, name: string): void {
  if (b.length !== DIGEST_BYTES) {
    throw new RangeError(`${name} must be ${DIGEST_BYTES} bytes, got ${b.length}`);
  }
}

/** Validate every field width. Throws on any out-of-range value. */
export function assertLeaf(leaf: Leaf): void {
  assertUint(leaf.addr, BITS.ADDR);
  assertUint(leaf.nextAddr, BITS.ADDR);
  if (leaf.nextAddr !== 0n && leaf.nextAddr <= leaf.addr) {
    throw new Error(
      `leaf linked-list order broken: addr ${formatAddr(leaf.addr)} >= nextAddr ${formatAddr(leaf.nextAddr)}`,
    );
  }
  for (const f of METRIC_FIELDS) assertUint(leaf.metrics[f], BITS.U128);
  assertBytes32(leaf.depthRoot, "depthRoot");
  assertBytes32(leaf.flowRoot, "flowRoot");
}

/**
 * Canonical big-endian byte image of a leaf. Field order is fixed and part of
 * the protocol: changing it changes every root.
 *
 *   addr(20) | nextAddr(20) | isProtocol(1) | 12 x metric(16) | depthRoot(32) | flowRoot(32)
 */
export function encodeLeaf(leaf: Leaf): Uint8Array {
  assertLeaf(leaf);
  const parts: Uint8Array[] = [
    encodeUint(leaf.addr, BITS.ADDR),
    encodeUint(leaf.nextAddr, BITS.ADDR),
    new Uint8Array([leaf.isProtocol ? 1 : 0]),
  ];
  for (const f of METRIC_FIELDS) parts.push(encodeUint(leaf.metrics[f], BITS.U128));
  parts.push(leaf.depthRoot, leaf.flowRoot);

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function hashLeaf(hasher: Hasher, leaf: Leaf): Digest {
  return hasher.hashLeaf(encodeLeaf(leaf));
}

export function zeroMetrics(): LeafMetrics {
  return {
    baseStart: 0n,
    baseEnd: 0n,
    quoteEnd: 0n,
    lpBase: 0n,
    lpQuote: 0n,
    xferIn: 0n,
    xferOut: 0n,
    fromTreasury: 0n,
    swapBaseIn: 0n,
    swapBaseOut: 0n,
    swapQuoteIn: 0n,
    swapQuoteOut: 0n,
  };
}

/** The canonical empty padding leaf (not part of the linked list). */
export function emptyLeaf(): Leaf {
  return {
    addr: 0n,
    nextAddr: 0n,
    isProtocol: false,
    metrics: zeroMetrics(),
    depthRoot: new Uint8Array(DIGEST_BYTES),
    flowRoot: new Uint8Array(DIGEST_BYTES),
  };
}
