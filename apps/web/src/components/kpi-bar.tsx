// One hue for every bar: the bars show how often each KPI was met, on one 0–100 scale, and
// the engagement's targets are private, so the record has no public threshold to colour
// against. The track is a pale step of the same blue (`.meter-data` in globals.css).
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
        className="meter meter-data"
        role="meter"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <span style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
