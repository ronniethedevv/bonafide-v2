"use client";

import { useState } from "react";

// The client's dispute affordance. A settled epoch can be challenged inside its window:
// the client posts a matching bond, the attesters' root is re-examined, and it escalates
// to the committee vote (UMA-style). This surfaces that path — who can dispute, with what
// bond, over what window — instead of leaving it back-office only.
export function ChallengePanel({
  challengeableEpoch,
  windowHours,
  mmBond,
}: {
  challengeableEpoch: number | null;
  windowHours: number;
  mmBond: string;
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
        <div className="eyebrow" style={{ color: "var(--warn)", marginBottom: 6 }}>Challenge raised</div>
        <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
          Your challenge to epoch {challengeableEpoch} is open. The committee re-examines the
          published data and votes; if the result is overturned the MM&apos;s bond is slashed
          and your matching bond is returned, otherwise your bond is forfeit. (Demo — nothing
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
        If you believe epoch {challengeableEpoch}&apos;s result is wrong, raise a challenge
        within the window. You post a bond matching the MM&apos;s <span className="mono" style={{ color: "var(--text)" }}>{mmBond}</span>;
        the committee re-examines the published data and votes. If the result was wrong,
        the MM is slashed; if it holds up, your bond is forfeit.
      </p>
      {!open ? (
        <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => setOpen(true)}>Raise a challenge</button>
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
              Post bond &amp; challenge
            </button>
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
