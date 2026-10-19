import type { Tier } from "@/lib/read-model";

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

// Shape glyph + label, never colour alone (colour-blind safe, per ui_context).
const GLYPH: Record<Tier, string> = { A: "◆", B: "▲", C: "●" };

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 10px",
        borderRadius: 999,
        border: `1px solid ${COLOR[tier]}`,
        color: COLOR[tier],
        fontSize: 13,
      }}
    >
      <span aria-hidden="true">{GLYPH[tier]}</span>
      {LABEL[tier]}
    </span>
  );
}
