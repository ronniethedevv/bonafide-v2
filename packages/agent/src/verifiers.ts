// The agent's signature checks for wallet ownership (@mmr/engagement-file/verify), on its own
// viem: a plain signature is recovered locally, a smart wallet's checked on its chain.

import { createPublicClient, http, recoverMessageAddress, type Address, type Hex } from "viem";
import { base, mainnet } from "viem/chains";
import type { SignatureVerifiers } from "@mmr/engagement-file/verify";

export const verifiers: SignatureVerifiers = {
  recover: (message, signature) => recoverMessageAddress({ message, signature: signature as Hex }),
  smartWallet: (a) =>
    createPublicClient({ chain: a.chainId === 1 ? mainnet : base, transport: http() })
      .verifyMessage({ address: a.address as Address, message: a.message, signature: a.signature as Hex }),
};
