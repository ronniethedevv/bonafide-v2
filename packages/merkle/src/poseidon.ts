// Poseidon (Compact `transientHash`) hasher: the production tree hasher.
//
// The epoch circuit hashes every Merkle leaf and node with `transientHash`
// (Poseidon over the BLS12-381 scalar field), so tree digests are Field
// elements. This class reproduces it exactly by calling compact-runtime's own
// `transientHash` over the same Compact types the circuit hashes; nothing is
// re-implemented here. Checked by the KAT in packages/contracts/test.
//
// Digest encoding: a Field f is carried as its 32-byte little-endian image,
// which is exactly Compact's `f as Bytes<32>` cast (convertFieldToBytes). The
// public `rootOfRoots: Bytes<32>` is therefore just `RootOfRoots.root`, and a
// witness sibling / poolRoot (a Field) is `convertBytesToField` of the digest.
// Digests >= the field modulus are rejected (no non-canonical encodings).
//
// Hasher contract: `hashLeaf` takes only the leaf images the circuit hashes,
// told apart by length, and decodes each back to its Compact struct:
//   encodeLeaf      ( 297 B) -> SlotLeafCore -> transientHash<SlotLeafCore>
//   encodePoolLeaf  (  52 B) -> PoolEntry    -> transientHash<PoolEntry>
//   band leaf       (1544 B) -> BandSeries   -> transientHash<BandSeries>  (depth_root, H1)
//   flow leaf       (  36 B) -> FlowWindow   -> transientHash<FlowWindow>  (flow_root, M1)
// (band/flow images are built by @mmr/indexer commit.ts.) Any other preimage
// throws: wallet/terms commitments are persistentCommit, not tree leaves (DD-8).
//
// Lives at "@mmr/merkle/poseidon" (not the package root) so the core tree code
// does not load the runtime's WASM.

import * as rt from "@midnight-ntwrk/compact-runtime";
import { type Digest, type Hasher, DIGEST_BYTES } from "./hash.js";
import { BITS } from "./uint.js";

/** A CompactType built from parts, the way the compiler emits struct descriptors. */
type Desc = rt.CompactType<unknown>;

const U32 = new rt.CompactTypeUnsignedInteger((1n << 32n) - 1n, 4);
const U64 = new rt.CompactTypeUnsignedInteger((1n << 64n) - 1n, 8);
const U160 = new rt.CompactTypeUnsignedInteger((1n << 160n) - 1n, BITS.ADDR / 8);
const U128 = new rt.CompactTypeUnsignedInteger((1n << 128n) - 1n, BITS.U128 / 8);
const B32 = new rt.CompactTypeBytes(DIGEST_BYTES);
const FIELD = rt.CompactTypeField;
const BOOL = rt.CompactTypeBoolean;
const NODE = new rt.CompactTypeVector(2, FIELD);

/** One struct field: its descriptor, byte width in the leaf image, and decoder. */
interface Part {
  t: Desc;
  n: number;
  dec: (b: Uint8Array) => unknown;
}

const uint = (t: rt.CompactTypeUnsignedInteger, n: number): Part => ({
  t: t as Desc, n, dec: (b) => rt.convertBytesToUint((1n << BigInt(8 * n)) - 1n, n, b, "PoseidonHasher"),
});
const bool: Part = {
  t: BOOL as Desc, n: 1,
  dec: (b) => {
    if (b[0]! > 1) throw new RangeError(`PoseidonHasher: boolean byte ${b[0]}`);
    return b[0] === 1;
  },
};
const bytes32: Part = { t: B32 as Desc, n: DIGEST_BYTES, dec: (b) => b };
const field: Part = { t: FIELD as Desc, n: DIGEST_BYTES, dec: (b) => digestToField(b) };

// SlotLeafCore in epoch_proof.compact, field for field (order is protocol).
const SLOT_LEAF_CORE: readonly Part[] = [
  uint(U160, 20), uint(U160, 20), bool,
  ...Array.from({ length: 12 }, () => uint(U128, 16)),
  bytes32, bytes32,
];
// PoolEntry in epoch_proof.compact: { poolAddr: Uint<160>, poolRoot: Field }.
const POOL_ENTRY: readonly Part[] = [uint(U160, 20), field];
// BandSeries in epoch_proof.compact: { band_bps: Uint<64>, bid: Vector<48, Uint<128>>,
// ask: Vector<48, Uint<128>> }. A vector hashes as its elements in order.
const BAND_SERIES: readonly Part[] = [
  uint(U64, 8),
  ...Array.from({ length: 2 * 48 }, () => uint(U128, 16)),
];
// FlowWindow (I7 / M1): { window: Uint<32>, buy: Uint<128>, sell: Uint<128> }.
const FLOW_WINDOW: readonly Part[] = [uint(U32, 4), uint(U128, 16), uint(U128, 16)];

const imageLen = (parts: readonly Part[]) => parts.reduce((s, p) => s + p.n, 0);
const LAYOUTS = new Map<number, readonly Part[]>([
  [imageLen(SLOT_LEAF_CORE), SLOT_LEAF_CORE], // 297
  [imageLen(POOL_ENTRY), POOL_ENTRY],         // 52
  [imageLen(BAND_SERIES), BAND_SERIES],       // 1544
  [imageLen(FLOW_WINDOW), FLOW_WINDOW],       // 36
]);

/** Decode a leaf image into a struct value and hash it as the circuit does. */
function hashStruct(parts: readonly Part[], img: Uint8Array): bigint {
  const values: unknown[] = [];
  let off = 0;
  for (const p of parts) {
    values.push(p.dec(img.subarray(off, off + p.n)));
    off += p.n;
  }
  const desc = {
    alignment: () => parts.flatMap((p) => p.t.alignment()),
    toValue: (vs: unknown[]) => parts.flatMap((p, i) => p.t.toValue(vs[i])),
    fromValue: () => { throw new Error("PoseidonHasher: fromValue unused"); },
  } as unknown as rt.CompactType<unknown[]>;
  return rt.transientHash(desc, values);
}

/** Field -> 32-byte LE digest, exactly Compact's `Field as Bytes<32>`. */
export function fieldToDigest(f: bigint): Digest {
  return rt.convertFieldToBytes(DIGEST_BYTES, f, "PoseidonHasher");
}

/** 32-byte LE digest -> Field, exactly Compact's `Bytes<32> as Field`; throws if >= modulus. */
export function digestToField(d: Digest): bigint {
  if (d.length !== DIGEST_BYTES) throw new RangeError("digest must be 32 bytes");
  return rt.convertBytesToField(DIGEST_BYTES, d, "PoseidonHasher");
}

export class PoseidonHasher implements Hasher {
  readonly id = "compact-transient-hash-v1";

  hashLeaf(preimage: Uint8Array): Digest {
    const layout = LAYOUTS.get(preimage.length);
    if (!layout) {
      throw new RangeError(
        `PoseidonHasher hashes only slot (297 B) / pool (52 B) / band (1544 B) / flow (36 B) leaf images, got ${preimage.length} B`,
      );
    }
    return fieldToDigest(hashStruct(layout, preimage));
  }

  hashNode(left: Digest, right: Digest): Digest {
    return fieldToDigest(rt.transientHash(NODE, [digestToField(left), digestToField(right)]));
  }
}
