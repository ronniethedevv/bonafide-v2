function colorFor(pct: number): string {
  if (pct >= 95) return "var(--pos)";
  if (pct >= 80) return "var(--warn)";
  return "var(--neg)";
}

export function KpiBar({ label, pct }: { label: string; pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        className="row"
        style={{ justifyContent: "space-between", marginBottom: 4 }}
      >
        <span className="muted" style={{ fontSize: 13 }}>
          {label}
        </span>
        <span className="mono" style={{ fontSize: 13 }}>
          {clamped}%
        </span>
      </div>
      <div
        style={{
          height: 6,
          background: "var(--surface-2)",
          borderRadius: 999,
          overflow: "hidden",
        }}
        role="meter"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          style={{
            width: `${clamped}%`,
            height: "100%",
            background: colorFor(clamped),
          }}
        />
      </div>
    </div>
  );
}
