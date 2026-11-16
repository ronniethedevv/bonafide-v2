import type { EngagementState } from "@/lib/mm-dashboard";
import { STATE_LABEL } from "@/lib/mm-dashboard";

const TONE: Record<EngagementState, { bg: string; fg: string; dot: string }> = {
  registered: { bg: "var(--surface-2)", fg: "var(--text-muted)", dot: "var(--text-dim)" },
  active: { bg: "var(--accent-soft)", fg: "var(--accent-2)", dot: "var(--accent)" },
  at_risk: { bg: "color-mix(in srgb, var(--warn) 16%, transparent)", fg: "var(--warn)", dot: "var(--warn)" },
  completed: { bg: "color-mix(in srgb, var(--pos) 16%, transparent)", fg: "var(--pos)", dot: "var(--pos)" },
  claimed: { bg: "var(--surface-2)", fg: "var(--text)", dot: "var(--pos)" },
  defaulted: { bg: "color-mix(in srgb, var(--neg) 16%, transparent)", fg: "var(--neg)", dot: "var(--neg)" },
};

export function StateBadge({ state }: { state: EngagementState }) {
  const t = TONE[state];
  return (
    <span
      className="pill"
      style={{ background: t.bg, color: t.fg, borderColor: "transparent", gap: 7 }}
    >
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: t.dot, display: "inline-block" }} />
      {STATE_LABEL[state]}
    </span>
  );
}
