// Real TreePublisher backed by Pinata (IPFS).
//
// Storage segregation (blueprint §1.2.3): the FULL Merkle tree is published to a
// content-addressed store before its root is attested, so anyone with the CID can
// fetch the tree and recompute the root. Only the resulting CID (a minimal marker)
// travels on-chain.
//
// Uses Pinata's v3 file-upload API over `fetch` — no SDK, so nothing is pinned to a
// client version. The endpoint + success-body shape are **[verify]** against current
// Pinata docs (https://docs.pinata.cloud) before trusting a live run; the response
// parse is defensive and fails loudly rather than guessing a CID.
//
// This is a boundary (code_standards "Error handling"): it validates its inputs and
// throws typed errors; `fetch` is injectable so the logic is unit-tested with a fake
// transport and no network. Public IPFS ("network": "public") is used so the CID
// resolves on any gateway — the recomputability guarantee requires public retrieval.

import type { TreePublisher } from "./provider.js";
import type { FetchLike } from "./http.js";

export interface PinataConfig {
  /** Pinata JWT (scoped Files:Write). Read from env, never committed. */
  readonly jwt: string;
  /** File-upload host. Pinata v3 uploads go to uploads.pinata.cloud, not the API host. */
  readonly uploadBaseUrl?: string;
  /** Dedicated gateway base, e.g. https://<sub>.mypinata.cloud — required for `retrieve`. */
  readonly gatewayUrl?: string;
  /** IPFS network. "public" (default) so the CID resolves on any gateway. */
  readonly network?: "public" | "private";
  /** Per-request timeout; the pipeline must fail loudly, never hang. */
  readonly timeoutMs?: number;
  /** Injected transport; defaults to global fetch. */
  readonly fetchImpl?: FetchLike;
}

const DEFAULT_UPLOAD_BASE = "https://uploads.pinata.cloud";
const DEFAULT_TIMEOUT_MS = 30_000;

// CIDv0 (Qm… base58, 46 chars) or CIDv1 (b… base32 lowercase). A shape guard only —
// Pinata is authoritative for the CID; we reject an obviously-wrong body.
const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/;

export class PinataPublishError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "PinataPublishError";
  }
}

export class PinataTreePublisher implements TreePublisher {
  private readonly jwt: string;
  private readonly uploadBaseUrl: string;
  private readonly gatewayUrl: string | undefined;
  private readonly network: "public" | "private";
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(cfg: PinataConfig) {
    if (!cfg.jwt || cfg.jwt.trim() === "") {
      throw new PinataPublishError("missing Pinata JWT");
    }
    const fetchImpl = cfg.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchImpl) throw new PinataPublishError("no fetch implementation available");
    this.jwt = cfg.jwt;
    this.uploadBaseUrl = (cfg.uploadBaseUrl ?? DEFAULT_UPLOAD_BASE).replace(/\/+$/, "");
    this.gatewayUrl = cfg.gatewayUrl?.replace(/\/+$/, "");
    this.network = cfg.network ?? "public";
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = fetchImpl;
  }

  /** Read config from the runtime env (PINATA_JWT, optional PINATA_GATEWAY). */
  static fromEnv(env: Record<string, string | undefined> = process.env): PinataTreePublisher {
    const jwt = env.PINATA_JWT;
    if (!jwt) throw new PinataPublishError("PINATA_JWT is not set");
    const gatewayUrl = env.PINATA_GATEWAY;
    return new PinataTreePublisher(gatewayUrl ? { jwt, gatewayUrl } : { jwt });
  }

  /** Publish the tree bytes; return the content id (CID). */
  async publish(bytes: Uint8Array): Promise<string> {
    if (bytes.length === 0) throw new PinataPublishError("refusing to publish empty bytes");

    const form = new FormData();
    // A deterministic, human-readable name; the CID is over the file content, not the
    // name, so repeated publishes of identical bytes yield the same CID.
    form.append("file", new Blob([bytes]), "epoch-tree.bin");
    form.append("network", this.network);

    const res = await this.send(`${this.uploadBaseUrl}/v3/files`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.jwt}` },
      body: form,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new PinataPublishError(`Pinata upload failed (${res.status})`, res.status, text);
    }
    return extractCid(text);
  }

  /**
   * Fetch published bytes back by CID via the configured gateway. Not part of the
   * TreePublisher contract — used to prove a publish round-trips to the same bytes.
   */
  async retrieve(cid: string): Promise<Uint8Array> {
    if (!this.gatewayUrl) throw new PinataPublishError("gatewayUrl is required for retrieve");
    if (!CID_RE.test(cid)) throw new PinataPublishError(`not a CID: ${cid}`);
    const res = await this.send(`${this.gatewayUrl}/ipfs/${cid}`, { method: "GET" });
    if (!res.ok) {
      throw new PinataPublishError(`gateway fetch failed (${res.status})`, res.status);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new PinataPublishError(`request to ${url} timed out after ${this.timeoutMs}ms`);
      }
      throw new PinataPublishError(`request to ${url} failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Parse Pinata's success body and return a validated CID, or throw. */
function extractCid(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new PinataPublishError("Pinata response was not JSON", undefined, body);
  }
  // v3 shape: { data: { cid, ... } }. Tolerate a top-level cid too, but never guess.
  const cid =
    (parsed as { data?: { cid?: unknown } }).data?.cid ?? (parsed as { cid?: unknown }).cid;
  if (typeof cid !== "string" || !CID_RE.test(cid)) {
    throw new PinataPublishError("Pinata response missing a valid cid", undefined, body);
  }
  return cid;
}
