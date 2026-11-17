import type { PipelineStage } from "@/lib/mm-dashboard";
import { PIPELINE } from "@/lib/mm-dashboard";

const LABEL: Record<PipelineStage, string> = {
  register: "Register",
  capture: "Capture",
  prove: "Prove",
  attest: "Attest",
  claim: "Claim",
  done: "Done",
};

// Register → Capture → Prove → Attest → Claim, with the current stage lit and prior
// stages marked done. Makes the async lifecycle legible (where is this epoch/engagement?).
export function PipelineStepper({ stage }: { stage: PipelineStage }) {
  const idx = stage === "done" ? PIPELINE.length : PIPELINE.indexOf(stage);
  return (
    <div className="row" style={{ gap: 0, alignItems: "center", flexWrap: "nowrap", overflowX: "auto" }}>
      {PIPELINE.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        const color = done ? "var(--pos)" : active ? "var(--accent)" : "var(--border-strong)";
        const text = done ? "var(--text-muted)" : active ? "var(--text-high)" : "var(--text-dim)";
        return (
          <div key={s} className="row" style={{ gap: 0, alignItems: "center", flex: i < PIPELINE.length - 1 ? 1 : "0 0 auto" }}>
            <div className="row" style={{ gap: 8, alignItems: "center", flexShrink: 0 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 22, height: 22, borderRadius: 999, flexShrink: 0,
                  background: done ? "var(--pos)" : active ? "var(--accent)" : "transparent",
                  border: `1.5px solid ${color}`, color: done || active ? "#06281c" : "var(--text-dim)",
                  display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600,
                }}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className="step-label" style={{ color: text, fontSize: 13, fontWeight: active ? 600 : 500, whiteSpace: "nowrap" }}>
                {LABEL[s]}
              </span>
            </div>
            {i < PIPELINE.length - 1 && (
              <span style={{ flex: 1, height: 1.5, minWidth: 16, margin: "0 10px", background: done ? "var(--pos)" : "var(--border)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
