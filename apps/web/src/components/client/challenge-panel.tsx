"use client";

import { useState } from "react";

// The client's dispute affordance, matching the contract (DD-35): inside a settled epoch's
// window, the client asks the attester committee to recheck that day's published root.
// Members whose watchers recompute a different root vote disputeRoot; at 2 of 3 the root
// is disputed on-chain and nothing on that day settles, releases or defaults. The client
// posts no bond, and the MM is not slashed for a root it did not make.
export function ChallengePanel({
  challengeableEpoch,
  windowHours,
}: {
  challengeableEpoch: number | null;
  windowHours: number;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [raised, setRaised] = useState(false);

  if (challengeableEpoch === null) {
    return (
      <div className="card" style={{ padding: "16px 20px" }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>Dispute</div>
        <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.55 }}>
          No epoch is inside its challenge window right now. A result can be disputed only
          during the {windowHours}h window after it settles.
        </p>
      </div>
    );
  }

  if (raised) {
    return (
      <div className="card" style={{ padding: "18px 20px", borderColor: "color-mix(in srgb, var(--warn) 40%, transparent)" }}>
        <div className="eyebrow" style={{ color: "var(--warn)", marginBottom: 6 }}>Dispute requested</div>
        <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
          You asked the attester committee to recheck epoch {challengeableEpoch}&apos;s root. Each
          member recomputes it from the public chain data; if two of three find it wrong, they
          dispute it on-chain and nothing for that day is settled or released. (Demo — nothing
          is submitted.)
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: "18px 20px" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="eyebrow">Dispute a result</div>
        <span className="pill" style={{ background: "color-mix(in srgb, var(--warn) 16%, transparent)", color: "var(--warn)", borderColor: "transparent", fontSize: 11 }}>
          epoch {challengeableEpoch} · {windowHours}h window open
        </span>
      </div>
      <p className="muted" style={{ fontSize: 13, margin: "10px 0 0", lineHeight: 1.6 }}>
        If you believe epoch {challengeableEpoch}&apos;s result rests on wrong data, ask the
        attester committee to recheck that day&apos;s published root within the window. Each
        member recomputes it from public chain data; if two of three find it wrong, the root
        is disputed on-chain and nothing for that day settles or releases. You post no bond.
      </p>
      {!open ? (
        <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => setOpen(true)}>Request a dispute</button>
      ) : (
        <div style={{ marginTop: 14 }}>
          <textarea
            placeholder={`Why is epoch ${challengeableEpoch}'s result wrong? (e.g. depth you observed vs the proven figure)`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ width: "100%", minHeight: 84, padding: "10px 12px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text)", fontFamily: "var(--font-body)", fontSize: 13, resize: "vertical" }}
          />
          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            <button className="btn btn-primary" disabled={reason.trim().length < 8} style={{ opacity: reason.trim().length < 8 ? 0.4 : 1 }} onClick={() => setRaised(true)}>
              Ask the committee to recheck
            </button>
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
