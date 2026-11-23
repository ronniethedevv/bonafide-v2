import { describe, expect, it } from "vitest";
import { recoverMessageAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { registrationFingerprint } from "./commitments.js";
import { ownershipMessage } from "./ownership.js";
import { checkOwnership, verifyWalletOwnership, type SignatureVerifiers } from "./verify.js";

const A = privateKeyToAccount(`0x${"11".repeat(32)}`);
const B = privateKeyToAccount(`0x${"22".repeat(32)}`);
const OTHER = privateKeyToAccount(`0x${"33".repeat(32)}`);
const COMMITS = { walletCommit: `0x${"aa".repeat(32)}`, termsCommit: `0x${"bb".repeat(32)}` };
const keysOnly: SignatureVerifiers = {
  recover: (message, signature) => recoverMessageAddress({ message, signature: signature as Hex }),
  smartWallet: async () => false,
};

async function signFor(account: typeof A, wallet: string, commits = COMMITS, chainId = 8453) {
  const fingerprint = await registrationFingerprint(commits.walletCommit, commits.termsCommit);
  return account.signMessage({ message: ownershipMessage({ wallet, chainId, fingerprint }) });
}

describe("wallet ownership", () => {
  it("accepts a proposal whose every wallet signed for this engagement", async () => {
    const wallets = [A.address, B.address].map((a) => a.toLowerCase());
    const ownership = [
      { wallet: wallets[0]!, signature: await signFor(A, wallets[0]!) },
      { wallet: wallets[1]!, signature: await signFor(B, wallets[1]!) },
    ];
    const c = await checkOwnership({ wallets, ownership, commitments: COMMITS, registration: { chainId: 8453 } }, keysOnly);
    expect(c.all).toBe(true);
    expect(c.wallets.map((w) => w.detail)).toEqual(["signed by the wallet's key", "signed by the wallet's key"]);
  });

  it("refuses a missing signature, another key's signature, or one for another engagement", async () => {
    const w = A.address.toLowerCase();
    expect((await checkOwnership({ wallets: [w], commitments: COMMITS }, keysOnly)).all).toBe(false);
    const byOther = await signFor(OTHER, w);
    expect((await checkOwnership({ wallets: [w], ownership: [{ wallet: w, signature: byOther }], commitments: COMMITS }, keysOnly)).all).toBe(false);
    const elsewhere = await signFor(A, w, { walletCommit: COMMITS.walletCommit, termsCommit: `0x${"cc".repeat(32)}` });
    expect((await checkOwnership({ wallets: [w], ownership: [{ wallet: w, signature: elsewhere }], commitments: COMMITS }, keysOnly)).all).toBe(false);
    const otherChain = await signFor(A, w, COMMITS, 1);
    expect((await checkOwnership({ wallets: [w], ownership: [{ wallet: w, signature: otherChain }], commitments: COMMITS, registration: { chainId: 8453 } }, keysOnly)).all).toBe(false);
  });

  it("falls back to the chain for a smart wallet", async () => {
    const fingerprint = await registrationFingerprint(COMMITS.walletCommit, COMMITS.termsCommit);
    const smartWallet = `0x${"5a".repeat(20)}`;
    const s = await verifyWalletOwnership({ wallet: smartWallet, signature: "0x1234", chainId: 8453, fingerprint }, { ...keysOnly, smartWallet: async (a) => a.address === smartWallet });
    expect(s).toMatchObject({ ok: true, detail: "signed by the smart wallet (checked on chain)" });
  });
});
