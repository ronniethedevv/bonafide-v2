// Client for the MM Reputation agent API (/api/agent/v1). Authenticated with the agent
// token from the workspace's "Connect agent". Sends phases and sealed envelopes only.

import type { SealedEnvelope } from "@mmr/engagement-file";

export type Phase = "captured" | "proven" | "submitted" | "settled";

export interface ServerEngagement {
  id: string;
  status: string;
  walletCommit: string | null;
  termsCommit: string | null;
  clientName: string;
  clientInboxKey: string | null;
  epochs: Array<{ epoch: number; phase: string }>;
}

export class AgentApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export class AgentApi {
  constructor(
    private readonly server: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.server.replace(/\/$/, "")}/api/agent/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new AgentApiError(res.status, json.error ?? `HTTP ${res.status}`);
    return json;
  }

  me(): Promise<{ handle: string; name: string }> {
    return this.call("GET", "/me");
  }

  async engagements(): Promise<ServerEngagement[]> {
    return (await this.call<{ engagements: ServerEngagement[] }>("GET", "/engagements")).engagements;
  }

  /** Returns false when the epoch was already at this phase or further. */
  async reportPhase(id: string, epoch: number, phase: Phase): Promise<boolean> {
    try {
      const r = await this.call<{ changed: boolean }>("PUT", `/engagements/${encodeURIComponent(id)}/epochs/${epoch}`, { phase });
      return r.changed;
    } catch (e) {
      if (e instanceof AgentApiError && e.status === 409 && /further along/.test(e.message)) return false;
      throw e;
    }
  }

  /** Returns false when figures for this epoch were already shared. */
  async postFigures(id: string, epoch: number, envelope: SealedEnvelope): Promise<boolean> {
    try {
      await this.call("POST", `/engagements/${encodeURIComponent(id)}/epochs/${epoch}/figures`, { envelope });
      return true;
    } catch (e) {
      if (e instanceof AgentApiError && e.status === 409 && /already shared/.test(e.message)) return false;
      throw e;
    }
  }
}
