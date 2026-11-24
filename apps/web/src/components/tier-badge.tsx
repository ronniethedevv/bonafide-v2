import type { Tier } from "@/lib/read-model";
import { TierShape } from "@/components/icons";

const COLOR: Record<Tier, string> = {
  A: "var(--tier-a)",
  B: "var(--tier-b)",
  C: "var(--tier-c)",
};

const LABEL: Record<Tier, string> = {
  A: "Tier A",
  B: "Tier B",
  C: "Sandbox · C",
};

// Shape + label, never colour alone (colour-blind safe, per ui_context). A neutral pill:
// only the small shape carries the tier's colour, so the badge does not compete with the data.
export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span
      className="pill"
      style={{ color: "var(--text)", background: "var(--surface-2)", fontWeight: 550 }}
    >
      <span style={{ color: COLOR[tier], display: "inline-flex" }}>
        <TierShape tier={tier} />
      </span>
      {LABEL[tier]}
    </span>
  );
}
