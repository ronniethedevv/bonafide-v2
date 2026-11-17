"use client";

import { useState } from "react";
import { ArrowRight, Info } from "@/components/icons";

function explain(action: string): string {
  if (action.startsWith("Capture")) {
    return "Reads this epoch's on-chain activity for your committed wallets and saves a private record (the witness) that stays with you.";
  }
  if (action.startsWith("Prove")) {
    return "Turns the private record into a zero-knowledge proof that you met the targets, and submits it to Midnight for the attesters to check.";
  }
  if (action.startsWith("Claim")) {
    return "Proves the engagement's overall result and adds it to your public record, without revealing the client or any figures.";
  }
  return "Moves this engagement to its next step.";
}

// The engagement's next-step button. In this preview nothing is submitted: clicking it
// says plainly what the step does and how it runs today, instead of pretending.
export function ActionButton({ action }: { action: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
      <button className="btn btn-primary link-arrow" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>{action}</span>
        <ArrowRight size={16} />
      </button>
      {open && (
        <div className="action-note" role="status">
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Info size={14} style={{ marginTop: 2, color: "var(--accent-2)" }} />
            <div>
              {explain(action)}
              <div className="dim" style={{ marginTop: 6 }}>
                Preview: nothing is submitted from this button yet. Today this step runs from
                the market maker&apos;s own prover tools; running it from the app is on the roadmap.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
