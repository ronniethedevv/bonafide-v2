import { describe, expect, it } from "vitest";
import { recoverMessageAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { contexts, inboxKeyFromSignature, open, termsToJson, type ClientTermsPayload } from "@mmr/engagement-file";
import { checkOwnership, type SignatureVerifiers } from "@mmr/engagement-file/verify";
import { attachOwnership, createOpening, ownershipTasks, proposalFor, type NewEngagement } from "./propose.js";

const W1 = privateKeyToAccount(`0x${"41".repeat(32)}`);
const W2 = privateKeyToAccount(`0x${"42".repeat(32)}`);
const SOMEONE = privateKeyToAccount(`0x${"43".repeat(32)}`);
// Plain keys only: no chain lookups in tests.
const noSmart: SignatureVerifiers = {
  recover: (message, signature) => recoverMessageAddress({ message, signature: signature as Hex }),
  smartWallet: async () => false,
};

const NEW: NewEngagement = {
  clientAddress: `0x${"c1".repeat(20)}`,
  beneficiary: "f7".repeat(32),
  chainId: 8453,
  pool: { address: "0x529d2863a1521d0b57db028168fde2e97120017c", pair: "VIRTUAL/USDC", base: { symbol: "VIRTUAL", decimals: 18 }, quote: { symbol: "USDC", decimals: 6 } },
  wallets: [W1.address, W2.address],
  terms: termsToJson({
    floorPriceP: 0n, loanL0: 0n, quoteStartQ0: 0n, disposalD: 1n << 100n, netSellS: 1n << 100n,
    depthTarget: 250_000_000n, roundtripSharePpm: 1_000_000n, bandBps: 200, minUptimeBuckets: 36, epochsTotal: 30, pool: 0n,
  }),
  tier: 1,
  bond: "10000",
  label: "virtual-retainer",
};

async function signed(o: Awaited<ReturnType<typeof createOpening>>, signer = (w: string) => (w === W1.address.toLowerCase() ? W1 : W2)) {
  const sigs: Record<string, string> = {};
  for (const t of await ownershipTasks(o)) sigs[t.wallet] = await signer(t.wallet).signMessage({ message: t.message });
  return sigs;
}

describe("the market maker creates and proposes an engagement locally", () => {
  it("commits the engagement's pool and the client's key, and lists one message per wallet", async () => {
    const o = await createOpening(NEW);
    expect(o.terms.pool).toBe(BigInt(NEW.pool.address).toString());
    expect(o.registration).toEqual({ tier: 1, chainId: 8453, bond: "10000", beneficiary: NEW.beneficiary });
    const tasks = await ownershipTasks(o);
    expect(tasks.map((t) => t.wallet)).toEqual(o.wallets);
    expect(tasks[0]!.message).toContain(`Wallet: ${o.wallets[0]}`);
  });

  it("refuses to propose until every wallet has signed for this engagement", async () => {
    const o = await createOpening(NEW);
    const sigs = await signed(o);
    await expect(attachOwnership(o, { [o.wallets[0]!]: sigs[o.wallets[0]!]! }, noSmart)).rejects.toThrow(/not proven/);
    await expect(attachOwnership(o, await signed(o, () => SOMEONE), noSmart)).rejects.toThrow(/not proven/);
    await expect(proposalFor(o, "0x00")).rejects.toThrow(/ownership/);
  });

  it("sends the server only commitments and the client's sealed copy, which the client can verify", async () => {
    const client = await inboxKeyFromSignature(`0x${"ab".repeat(65)}`);
    // Signatures for another opening (other salts, so another fingerprint) do not carry over.
    const other = await createOpening(NEW);
    await expect(attachOwnership(await createOpening(NEW), await signed(other), noSmart)).rejects.toThrow(/not proven/);

    const o = await createOpening(NEW);
    const proposal = await proposalFor(await attachOwnership(o, await signed(o), noSmart), client.publicKey);
    expect(Object.keys(proposal).sort()).toEqual(["clientAddress", "termsCommit", "termsEnvelope", "walletCommit"]);
    expect(JSON.stringify(proposal)).not.toContain(o.wallets[0]!.slice(2));

    const payload = JSON.parse(await open(proposal.termsEnvelope, client.privateKey, contexts.terms(proposal.walletCommit, proposal.termsCommit))) as ClientTermsPayload;
    expect(JSON.stringify(payload)).not.toContain(o.secrets.engagementSecret.slice(2));
    expect("label" in payload).toBe(false);
    expect((await checkOwnership(payload, noSmart)).all).toBe(true);
  });
});
