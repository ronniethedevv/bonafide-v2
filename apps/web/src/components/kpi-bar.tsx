function fillFor(pct: number): string {
  // Semantic tone, but as a gentle gradient so the meters read as one system.
  if (pct >= 95) return "linear-gradient(90deg, #2fb87d, var(--pos))";
  if (pct >= 80) return "linear-gradient(90deg, #d8911e, var(--warn))";
  return "linear-gradient(90deg, #e05656, var(--neg))";
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
