import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { AttesterCommitteeMembers, attesterId, cidBytes, type PublishRootTx } from "./attester.js";

const secrets = [0xa1, 0xa2, 0xa3].map((b) => new Uint8Array(32).fill(b));
const ROOT = `0x${"11".repeat(32)}`;

function committee(online?: number[]) {
  const sent: PublishRootTx[] = [];
  const c = new AttesterCommitteeMembers({ secrets, threshold: 2, submit: async (tx) => void sent.push(tx), ...(online ? { online } : {}) });
  return { c, sent };
}

describe("attesterId", () => {
  it("is SHA-256(pad32(tag) ‖ secret), distinct per member", () => {
    const tag = Buffer.alloc(32);
    tag.write("mmr:attester:v1");
    const want = createHash("sha256").update(tag).update(secrets[0]!).digest();
    expect(Buffer.from(attesterId(secrets[0]!))).toEqual(want);
    expect(new Set(secrets.map((s) => Buffer.from(attesterId(s)).toString("hex"))).size).toBe(3);
  });

  it("rejects a secret that is not 32 bytes", () => {
    expect(() => attesterId(new Uint8Array(31))).toThrow(/32 bytes/);
  });
});

describe("AttesterCommitteeMembers (I8: each member submits publishRoot)", () => {
  it("every online member submits its own publishRoot with the same (epoch, root, cid)", async () => {
    const { c, sent } = committee();
    const votes = await c.publishRoot(7, ROOT, "bafy-tree");
    expect(sent.map((t) => t.secret)).toEqual(secrets);
    for (const t of sent) {
      expect(t.epoch).toBe(7n);
      expect(Buffer.from(t.rootOfRoots).toString("hex")).toBe("11".repeat(32));
      expect(t.cid).toEqual(cidBytes("bafy-tree"));
    }
    expect(votes.map((v) => v.attester)).toEqual(c.memberIds.map((m) => `0x${Buffer.from(m).toString("hex")}`));
  });

  it("an offline member submits nothing (the contract decides whether 2 of 3 is met)", async () => {
    const { c, sent } = committee([2, 0]);
    const votes = await c.publishRoot(1, ROOT, "cid");
    expect(sent.map((t) => t.secret)).toEqual([secrets[0], secrets[2]]);
    expect(votes).toHaveLength(2);
  });

  it("rejects a bad threshold, duplicate members, an unknown online index and a bad root", async () => {
    const submit = async () => {};
    expect(() => new AttesterCommitteeMembers({ secrets, threshold: 4, submit })).toThrow(/threshold/);
    expect(() => new AttesterCommitteeMembers({ secrets: [secrets[0]!, secrets[0]!], threshold: 1, submit })).toThrow(/distinct/);
    expect(() => new AttesterCommitteeMembers({ secrets, threshold: 2, submit, online: [3] })).toThrow(/no member 3/);
    await expect(committee().c.publishRoot(1, "0x12", "cid")).rejects.toThrow(/32-byte hex/);
  });

  it("cidBytes pads to 64 bytes and rejects longer cids", () => {
    expect(cidBytes("ab")).toEqual(new Uint8Array([97, 98, ...new Array(62).fill(0)]));
    expect(() => cidBytes("x".repeat(65))).toThrow(/longer than 64/);
  });
});
