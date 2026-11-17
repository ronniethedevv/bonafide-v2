import type { PipelineStage } from "@/lib/mm-dashboard";
import { PIPELINE } from "@/lib/mm-dashboard";
import { Check } from "@/components/icons";

const LABEL: Record<PipelineStage, string> = {
  register: "Register",
  capture: "Capture",
  prove: "Prove",
  attest: "Attest",
  claim: "Claim",
  done: "Done",
};

// Register, Capture, Prove, Attest, Claim: the current stage lit and prior stages marked
// done. On phones the per-step labels give way to one caption under the dots, so the row
// never clips and the spacing stays even.
export function PipelineStepper({ stage }: { stage: PipelineStage }) {
  const idx = stage === "done" ? PIPELINE.length : PIPELINE.indexOf(stage);
  return (
    <div>
      <div className="stepper" role="list" aria-label="Engagement stage">
        {PIPELINE.map((s, i) => {
          const done = i < idx;
          const active = i === idx;
          return (
            <div key={s} className="stepper-item" role="listitem" aria-current={active ? "step" : undefined}>
              <span className={`stepper-dot${done ? " is-done" : active ? " is-active" : ""}`}>
                {done ? <Check size={12} /> : i + 1}
              </span>
              <span className={`step-label${active ? " is-active" : ""}${done ? " is-done" : ""}`}>{LABEL[s]}</span>
              {i < PIPELINE.length - 1 && <span className={`stepper-line${done ? " is-done" : ""}`} />}
            </div>
          );
        })}
      </div>
      <div className="stepper-caption" aria-hidden="true">
        {stage === "done" ? (
          <strong>All stages complete</strong>
        ) : (
          <>
            Step {idx + 1} of {PIPELINE.length} · <strong>{LABEL[stage]}</strong>
          </>
        )}
      </div>
    </div>
  );
}
