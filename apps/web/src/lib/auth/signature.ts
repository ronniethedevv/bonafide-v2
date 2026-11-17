// Verify that `address` signed `message` (EIP-191): locally for ordinary wallets,
// on-chain (ERC-1271 / ERC-6492) for smart-contract wallets.

import { createPublicClient, http, isAddressEqual, recoverMessageAddress, type Address, type Hex } from "viem";
import { SIWE_CHAINS, isSiweChain } from "./siwe";

export async function verifyWalletSignature(a: { address: Address; message: string; signature: Hex; chainId: number }): Promise<boolean> {
  try {
    if (isAddressEqual(await recoverMessageAddress({ message: a.message, signature: a.signature }), a.address)) return true;
  } catch {
    // not a plain ECDSA signature: may be a smart wallet's
  }
  if (!isSiweChain(a.chainId)) return false;
  const rpc = a.chainId === 8453 ? process.env.BASE_RPC_URL : process.env.ETH_RPC_URL;
  try {
    const client = createPublicClient({ chain: SIWE_CHAINS[a.chainId], transport: http(rpc || undefined) });
    return await client.verifyMessage({ address: a.address, message: a.message, signature: a.signature });
  } catch {
    return false;
  }
}
