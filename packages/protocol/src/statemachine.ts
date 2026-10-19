// Engagement lifecycle reducer.
//
// Registered -> Funded -> Active -> (Settled | Defaulted)
//            \-> Voided (funding window passed, or unfunded)
// Only the client may terminate early; anyone may trigger a void/default once the
// relevant timeout passes; only a valid MM proof advances/settles an engagement.
// Pure and total: illegal transitions throw, so the caller can't reach a bad state.

import { type Timing } from "./timing.js";

export type EngagementStatus =
  | "Registered"
  | "Funded"
  | "Active"
  | "Settled"
  | "Voided"
  | "Defaulted";

export interface EngagementState {
  status: EngagementStatus;
  registeredAt: number;
  fundedAt: number | null;
  activatedAt: number | null;
  endedAt: number | null;
  endedReason: string | null;
}

export type EngagementEvent =
  | { type: "fund"; at: number }
  | { type: "activate"; at: number }
  | { type: "voidUnfunded"; at: number }
  | { type: "complete"; at: number }
  | { type: "default"; at: number }
  | { type: "terminateEarly"; at: number; by: "client" };

export class TransitionError extends Error {
  constructor(status: EngagementStatus, event: EngagementEvent["type"]) {
    super(`illegal transition: ${event} from ${status}`);
    this.name = "TransitionError";
  }
}

export function createEngagementState(registeredAt: number): EngagementState {
  return {
    status: "Registered",
    registeredAt,
    fundedAt: null,
    activatedAt: null,
    endedAt: null,
    endedReason: null,
  };
}

export function reduce(
  state: EngagementState,
  event: EngagementEvent,
  timing: Timing,
): EngagementState {
  switch (event.type) {
    case "fund": {
      if (state.status !== "Registered") throw new TransitionError(state.status, event.type);
      if (event.at > state.registeredAt + timing.fundingWindowSeconds) {
        throw new Error("funding window passed; engagement must be voided");
      }
      return { ...state, status: "Funded", fundedAt: event.at };
    }
    case "activate": {
      if (state.status !== "Funded") throw new TransitionError(state.status, event.type);
      return { ...state, status: "Active", activatedAt: event.at };
    }
    case "voidUnfunded": {
      if (state.status !== "Registered") throw new TransitionError(state.status, event.type);
      if (event.at < state.registeredAt + timing.fundingWindowSeconds) {
        throw new Error("funding window still open; cannot void yet");
      }
      return { ...state, status: "Voided", endedAt: event.at, endedReason: "unfunded" };
    }
    case "complete": {
      if (state.status !== "Active") throw new TransitionError(state.status, event.type);
      return { ...state, status: "Settled", endedAt: event.at, endedReason: "completed" };
    }
    case "default": {
      if (state.status !== "Active") throw new TransitionError(state.status, event.type);
      return { ...state, status: "Defaulted", endedAt: event.at, endedReason: "default" };
    }
    case "terminateEarly": {
      if (state.status !== "Active") throw new TransitionError(state.status, event.type);
      if (event.by !== "client") throw new Error("only the client may terminate early");
      return { ...state, status: "Settled", endedAt: event.at, endedReason: "client-terminated" };
    }
    default: {
      const _exhaustive: never = event;
      throw new Error(`unknown event ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export function isTerminal(status: EngagementStatus): boolean {
  return status === "Settled" || status === "Voided" || status === "Defaulted";
}
