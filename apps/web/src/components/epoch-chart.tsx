import type { EpochPoint } from "@/lib/read-model";

// Depth & uptime over epochs — the profile's hero chart. Two series on one
// shared 0-100% axis (never a dual axis). Identity is carried by colour AND marker
// shape AND a legend, never colour alone. Server-rendered inline SVG with native
// <title> hover tooltips and a <details> table view for accessibility.

const W = 920;
const H = 280;
const PAD = { top: 16, right: 60, bottom: 28, left: 40 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const Y_TICKS = [0, 25, 50, 75, 100];

type SeriesKey = "uptime" | "depth";
const SERIES: { key: SeriesKey; label: string; color: string; shape: "circle" | "square" }[] = [
  { key: "uptime", label: "Uptime", color: "var(--series-uptime)", shape: "circle" },
  { key: "depth", label: "Depth", color: "var(--series-depth)", shape: "square" },
];

function xAt(i: number, n: number): number {
  return n <= 1 ? PAD.left : PAD.left + (i / (n - 1)) * PLOT_W;
}
function yAt(v: number): number {
  const c = Math.max(0, Math.min(100, v));
  return PAD.top + (1 - c / 100) * PLOT_H;
}

export function EpochChart({ series }: { series: EpochPoint[] }) {
  const n = series.length;
  if (n === 0) return null;

  const last = series[n - 1]!;

  return (
    <figure className="card" style={{ margin: 0 }}>
      <figcaption
        className="row"
        style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}
      >
        <strong>Depth &amp; uptime over epochs</strong>
        <span className="row" style={{ gap: 16 }}>
          {SERIES.map((s) => (
            <span key={s.key} className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 10,
                  height: 10,
                  background: s.color,
                  borderRadius: s.shape === "circle" ? 999 : 2,
                  display: "inline-block",
                }}
              />
              {s.label}
            </span>
          ))}
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Depth and uptime per epoch, epochs ${series[0]!.epoch} to ${last.epoch}. Latest uptime ${last.uptime} percent, depth ${last.depth} percent.`}
        style={{ display: "block", height: "auto" }}
      >
        {/* recessive grid + y labels */}
        {Y_TICKS.map((t) => {
          const y = yAt(t);
          return (
            <g key={t}>
              <line x1={PAD.left} y1={y} x2={PAD.left + PLOT_W} y2={y} stroke="var(--border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
                {t}%
              </text>
            </g>
          );
        })}

        {/* x labels */}
        {series.map((p, i) => (
          <text key={p.epoch} x={xAt(i, n)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
            {p.epoch}
          </text>
        ))}

        {/* series lines + markers */}
        {SERIES.map((s) => {
          const pts = series.map((p, i) => `${xAt(i, n)},${yAt(p[s.key])}`).join(" ");
          return (
            <g key={s.key}>
              <polyline
                points={pts}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {series.map((p, i) => {
                const cx = xAt(i, n);
                const cy = yAt(p[s.key]);
                const title = `Epoch ${p.epoch} · ${s.label} ${p[s.key]}%`;
                return s.shape === "circle" ? (
                  <circle key={p.epoch} cx={cx} cy={cy} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2}>
                    <title>{title}</title>
                  </circle>
                ) : (
                  <rect key={p.epoch} x={cx - 4} y={cy - 4} width={8} height={8} rx={1} fill={s.color} stroke="var(--surface)" strokeWidth={2}>
                    <title>{title}</title>
                  </rect>
                );
              })}
              {/* direct label on the last point */}
              <text
                x={xAt(n - 1, n) + 8}
                y={yAt(last[s.key]) + (s.key === "uptime" ? -2 : 12)}
                fontSize={12}
                fill="var(--text)"
              >
                {last[s.key]}%
              </text>
            </g>
          );
        })}
      </svg>

      <details style={{ marginTop: 8 }}>
        <summary className="muted" style={{ fontSize: 13, cursor: "pointer" }}>
          Data table
        </summary>
        <table className="mono" style={{ width: "100%", marginTop: 8, borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
              <th style={{ padding: "4px 8px" }}>Epoch</th>
              <th style={{ padding: "4px 8px" }}>Uptime</th>
              <th style={{ padding: "4px 8px" }}>Depth</th>
            </tr>
          </thead>
          <tbody>
            {series.map((p) => (
              <tr key={p.epoch} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "4px 8px" }}>{p.epoch}</td>
                <td style={{ padding: "4px 8px" }}>{p.uptime}%</td>
                <td style={{ padding: "4px 8px" }}>{p.depth}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
