import type { EpochStatus } from "@/lib/mm-dashboard";

// A compact per-epoch grid (contribution-graph style): one cell per contracted epoch,
// colored by lifecycle phase and pass/fail. The MM sees at a glance which epochs are
// settled, in flight, pending, or failed.
function cellColor(ep: EpochStatus): { bg: string; border: string } {
  if (ep.phase === "pending") return { bg: "transparent", border: "var(--border)" };
  if (ep.pass === false) return { bg: "color-mix(in srgb, var(--neg) 70%, var(--surface))", border: "var(--neg)" };
  switch (ep.phase) {
    case "captured":
      return { bg: "color-mix(in srgb, var(--warn) 55%, var(--surface))", border: "var(--warn)" };
    case "proven":
      return { bg: "color-mix(in srgb, var(--accent) 45%, var(--surface))", border: "var(--accent)" };
    case "attested":
      return { bg: "color-mix(in srgb, var(--accent) 75%, var(--surface))", border: "var(--accent)" };
    case "settled":
      return { bg: "color-mix(in srgb, var(--pos) 70%, var(--surface))", border: "var(--pos)" };
    default:
      return { bg: "var(--surface-2)", border: "var(--border)" };
  }
}

const LEGEND: Array<{ label: string; color: string }> = [
  { label: "Settled · met", color: "color-mix(in srgb, var(--pos) 70%, var(--surface))" },
  { label: "Attested", color: "color-mix(in srgb, var(--accent) 75%, var(--surface))" },
  { label: "Proven", color: "color-mix(in srgb, var(--accent) 45%, var(--surface))" },
  { label: "Captured", color: "color-mix(in srgb, var(--warn) 55%, var(--surface))" },
  { label: "Missed", color: "color-mix(in srgb, var(--neg) 70%, var(--surface))" },
  { label: "Pending", color: "transparent" },
];

export function EpochGrid({ epochs }: { epochs: readonly EpochStatus[] }) {
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {epochs.map((ep) => {
          const c = cellColor(ep);
          const title =
            ep.phase === "pending"
              ? `Epoch ${ep.epoch}: pending`
              : `Epoch ${ep.epoch}: ${ep.phase}${ep.pass === false ? " · failed" : ep.pass ? " · passed" : ""}` +
                (ep.uptimeBuckets !== undefined ? ` · uptime ${ep.uptimeBuckets}/${ep.totalBuckets}` : "");
          return (
            <span
              key={ep.epoch}
              title={title}
              style={{
                width: 22, height: 22, borderRadius: 5, background: c.bg,
                border: `1px solid ${c.border}`, display: "inline-flex", alignItems: "center",
                justifyContent: "center", fontSize: 10,
                color: ep.phase === "pending" ? "var(--text-dim)" : "rgba(255,255,255,.9)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {ep.epoch}
            </span>
          );
        })}
      </div>
      <div className="row" style={{ gap: 14, marginTop: 14, flexWrap: "wrap" }}>
        {LEGEND.map((l) => (
          <span key={l.label} className="row" style={{ gap: 6, alignItems: "center" }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: l.color, border: "1px solid var(--border)", display: "inline-block" }} />
            <span className="dim" style={{ fontSize: 11 }}>{l.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
