// Shared transport type for the HTTP boundaries (IPFS publisher, EVM JSON-RPC).
// Injectable so those adapters are unit-tested with a fake and no network.
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
