// Demo sign-in. There are no real accounts yet, so a visitor picks a persona — one of the
// two market makers or one of the two clients in the demo world — and every private page
// is scoped to that persona: an MM sees only their own workspace, a client only the
// engagements they are party to. The cookie holds just the persona id (no secrets).
// Real authentication (wallet / SSO) replaces this; the scoping rules stay the same.

import { cookies } from "next/headers";
import { WORLD } from "./world";

export const SESSION_COOKIE = "mmr_demo_persona";

export type Session =
  | { kind: "mm"; id: string; handle: string; name: string }
  | { kind: "client"; id: string; clientId: string; name: string };

export interface Persona {
  session: Session;
  blurb: string;
}

export const PERSONAS: Persona[] = [
  ...WORLD.workspaces.map((w) => ({
    session: { kind: "mm" as const, id: `mm:${w.handle}`, handle: w.handle, name: w.displayName },
    blurb: `${w.engagements.length} engagements · clients ${[...new Set(w.engagements.map((e) => WORLD.clients[e.clientId]?.name ?? e.clientId))].join(", ")}`,
  })),
  ...Object.entries(WORLD.clients).map(([clientId, c]) => {
    const mms = WORLD.workspaces.filter((w) => w.engagements.some((e) => e.clientId === clientId));
    const n = mms.reduce((s, w) => s + w.engagements.filter((e) => e.clientId === clientId).length, 0);
    return {
      session: { kind: "client" as const, id: `client:${clientId}`, clientId, name: c.name },
      blurb: `${n} engagements · with ${mms.map((w) => w.displayName).join(", ")}`,
    };
  }),
];

export function personaById(id: string | undefined): Session | undefined {
  return id ? PERSONAS.find((p) => p.session.id === id)?.session : undefined;
}

export async function getSession(): Promise<Session | undefined> {
  const jar = await cookies();
  return personaById(jar.get(SESSION_COOKIE)?.value);
}

/** Where a persona lands after signing in. */
export function homeOf(s: Session): string {
  return s.kind === "mm" ? "/dashboard" : "/client";
}

/** Only same-site absolute paths are allowed as post-sign-in destinations. */
export function safeNext(next: unknown): string | undefined {
  if (typeof next !== "string") return undefined;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return undefined;
  return next;
}
