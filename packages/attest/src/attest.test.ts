import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PoseidonHasher } from "@mmr/merkle/poseidon";
import {
  buildAttestation,
  revokeAttestation,
  attestationUid,
  verifyAttestation,
  freshnessOf,
  isExpired,
  ATTESTATION_SCHEMA,
  type AttestableEpoch,
} from "./index.js";

// Real published epoch: the committed Base BROOMY/WETH fixture (Unit 3 milestone).
const dir = fileURLToPath(new URL("../../watcher/fixtures/base-8453-broomy-weth-2026-10-21/", import.meta.url));
const manifest = JSON.parse(readFileSync(dir + "manifest.json", "utf8")) as AttestableEpoch;
const tree = new Uint8Array(readFileSync(dir + "pool-tree.json"));
const poolAddr = manifest.pools[0]!.poolAddr;

const attesterSet = { id: "mmr-committee-1", threshold: 2, size: 3 };
const attestedAt = "2026-10-22T00:00:00.000Z";
const hasher = () => new PoseidonHasher();
const trees = () => new Map([[poolAddr, tree]]);

describe("@mmr/attest — build + client verification", () => {
  it("builds a schema-tagged attestation with a deterministic uid and honest coverage", () => {
    const a = buildAttestation(manifest, { attesterSet, attestedAt });
    expect(a.schema).toBe(ATTESTATION_SCHEMA);
    expect(a.rootOfRootsHex).toBe(manifest.rootOfRootsHex);
    expect(a.coverage.chains).toEqual([8453]);
    expect(a.coverage.scope).toBe("self-selected-public-engagements");
    expect(a.coverage.note).toMatch(/not a complete trading history/i);
    // uid is a pure function of the body — rebuilding gives the same id.
    expect(buildAttestation(manifest, { attesterSet, attestedAt }).uid).toBe(a.uid);
    const { uid, ...body } = a;
    expect(attestationUid(body)).toBe(uid);
  });

  it("verifies against the published tree with no trust in the issuer", () => {
    const a = buildAttestation(manifest, { attesterSet, attestedAt });
    const r = verifyAttestation(hasher(), a, trees(), Date.parse(attestedAt) + 86_400_000);
    expect(r.ok).toBe(true);
    expect(r.rootVerified).toBe(true);
    expect(r.uidValid).toBe(true);
    expect(r.recomputedRootOfRootsHex).toBe(manifest.rootOfRootsHex);
    expect(r.reasons).toEqual([]);
  });

  it("rejects a tampered body (uid no longer matches)", () => {
    const a = buildAttestation(manifest, { attesterSet, attestedAt });
    const forged = { ...a, rootOfRootsHex: "0x" + "00".repeat(32) };
    const r = verifyAttestation(hasher(), forged, trees(), Date.parse(attestedAt) + 86_400_000);
    expect(r.ok).toBe(false);
    expect(r.uidValid).toBe(false);
    expect(r.reasons.some((x) => /uid does not match/.test(x))).toBe(true);
  });

  it("rejects a re-id'd attestation whose root doesn't recompute from the tree", () => {
    const forgedBody: AttestableEpoch = { ...manifest, rootOfRootsHex: "0x" + "11".repeat(32) };
    const a = buildAttestation(forgedBody, { attesterSet, attestedAt }); // self-consistent uid, wrong root
    const r = verifyAttestation(hasher(), a, trees(), Date.parse(attestedAt) + 86_400_000);
    expect(r.ok).toBe(false);
    expect(r.uidValid).toBe(true);
    expect(r.rootVerified).toBe(false);
  });

  it("rejects a mutated published tree", () => {
    const a = buildAttestation(manifest, { attesterSet, attestedAt });
    const doc = JSON.parse(new TextDecoder().decode(tree));
    const leaf = doc.leaves.find((l: { addr: string }) => l.addr !== "0");
    leaf.metrics.swapBaseIn = (BigInt(leaf.metrics.swapBaseIn) + 1n).toString();
    const bad = new Map([[poolAddr, new TextEncoder().encode(JSON.stringify(doc))]]);
    const r = verifyAttestation(hasher(), a, bad, Date.parse(attestedAt) + 86_400_000);
    expect(r.ok).toBe(false);
    expect(r.rootVerified).toBe(false);
  });

  it("rejects a revoked attestation and re-ids it", () => {
    const a = buildAttestation(manifest, { attesterSet, attestedAt });
    const revoked = revokeAttestation(a);
    expect(revoked.revoked).toBe(true);
    expect(revoked.uid).not.toBe(a.uid);
    const r = verifyAttestation(hasher(), revoked, trees(), Date.parse(attestedAt) + 86_400_000);
    expect(r.ok).toBe(false);
    expect(r.revoked).toBe(true);
    expect(r.reasons).toContain("attestation is revoked");
  });

  it("enforces expiry (expired = invalid) but keeps freshness separate", () => {
    const a = buildAttestation(manifest, { attesterSet, attestedAt, validityDays: 90 });
    expect(a.expiresAt).not.toBeNull();
    // one day in: valid and fresh
    const early = verifyAttestation(hasher(), a, trees(), Date.parse(attestedAt) + 86_400_000);
    expect(early.ok).toBe(true);
    expect(early.expired).toBe(false);
    expect(early.freshness).toBe("fresh");
    // 100 days in: expired → invalid, and stale
    const late = verifyAttestation(hasher(), a, trees(), Date.parse(attestedAt) + 100 * 86_400_000);
    expect(late.ok).toBe(false);
    expect(late.expired).toBe(true);
    expect(late.freshness).toBe("stale");
    expect(isExpired(a, Date.parse(attestedAt) + 100 * 86_400_000)).toBe(true);
  });

  it("reports freshness buckets by age", () => {
    const base = Date.parse(attestedAt);
    expect(freshnessOf(attestedAt, base + 10 * 86_400_000)).toBe("fresh");
    expect(freshnessOf(attestedAt, base + 45 * 86_400_000)).toBe("ageing");
    expect(freshnessOf(attestedAt, base + 120 * 86_400_000)).toBe("stale");
  });
});
