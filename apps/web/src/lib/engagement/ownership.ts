// Wallet ownership checks in the browser: the shared logic in @mmr/engagement-file/verify,
// with this app's viem for the signatures (a smart wallet's is checked on its chain through
// the chain's public RPC).

import { createPublicClient, http, recoverMessageAddress, type Address, type Hex } from "viem";
import type { WalletOwnership } from "@mmr/engagement-file";
import * as shared from "@mmr/engagement-file/verify";

export type { OwnershipCheck, OwnershipStatus } from "@mmr/engagement-file/verify";

// Public RPC endpoints for the on-chain check (no chain registry in the browser bundle).
const RPC: Record<number, string> = { 8453: "https://mainnet.base.org", 1: "https://ethereum-rpc.publicnode.com" };

export const verifiers: shared.SignatureVerifiers = {
  recover: (message, signature) => recoverMessageAddress({ message, signature: signature as Hex }),
  smartWallet: async (a) => {
    const rpc = RPC[a.chainId];
    if (!rpc) return false;
    return createPublicClient({ transport: http(rpc) })
      .verifyMessage({ address: a.address as Address, message: a.message, signature: a.signature as Hex });
  },
};

export const verifyWalletOwnership = (a: { wallet: string; signature: string; chainId: number; fingerprint: string }) =>
  shared.verifyWalletOwnership(a, verifiers);

export const checkOwnership = (p: { wallets: string[]; ownership?: WalletOwnership[]; commitments: { walletCommit: string; termsCommit: string }; registration?: { chainId: number } }) =>
  shared.checkOwnership(p, verifiers);
