function fillFor(pct: number): string {
  // Semantic tone, but as a gentle gradient so the meters read as one system.
  if (pct >= 95) return "linear-gradient(90deg, color-mix(in srgb, var(--pos) 70%, var(--surface)), var(--pos))";
  if (pct >= 80) return "linear-gradient(90deg, color-mix(in srgb, var(--warn) 70%, var(--surface)), var(--warn))";
  return "linear-gradient(90deg, color-mix(in srgb, var(--neg) 70%, var(--surface)), var(--neg))";
}

export function KpiBar({ label, pct }: { label: string; pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ marginBottom: 11 }}>
      <div
        className="row"
        style={{ justifyContent: "space-between", marginBottom: 5 }}
      >
        <span className="muted" style={{ fontSize: 13 }}>
          {label}
        </span>
        <span className="mono" style={{ fontSize: 13 }}>
          {clamped}%
        </span>
      </div>
      <div
        className="meter"
        role="meter"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <span style={{ width: `${clamped}%`, background: fillFor(clamped) }} />
      </div>
    </div>
  );
}
