// Wallet ownership: with each committed trading wallet, the market maker signs a message
// naming that wallet, its chain and the engagement's registration fingerprint
// (SHA-256 of the wallet and terms commitments). The signature cannot be reused for another
// wallet or another engagement. It is a message signature (EIP-191), not a transaction: it
// moves no funds, and custody platforms can approve it under a signing policy. The client
// verifies every signature before accepting, so a market maker cannot commit wallets it does
// not control and take credit for someone else's liquidity.

export interface WalletOwnership {
  /** Lowercase 0x address of the committed wallet. */
  wallet: string;
  /** EIP-191 signature of ownershipMessage(...) by that wallet (or its ERC-1271 contract). */
  signature: string;
}

/**
 * The exact text each committed wallet signs. Its first line keeps the project's earlier
 * name: signatures already in engagement files were made over it.
 */
export function ownershipMessage(a: { wallet: string; chainId: number; fingerprint: string }): string {
  return [
    "mm-reputation: wallet ownership",
    "",
    "I control this wallet and commit it to the market-making engagement below.",
    "Signing moves no funds and grants no permissions.",
    "",
    `Wallet: ${a.wallet.toLowerCase()}`,
    `Chain: ${a.chainId}`,
    `Engagement: ${a.fingerprint.toLowerCase()}`,
  ].join("\n");
}
