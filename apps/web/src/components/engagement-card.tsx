import type { EngagementRecord, BondStatus } from "@/lib/read-model";
import { overallKpiHitRate } from "@/lib/read-model";
import { TierBadge } from "./tier-badge";
import { KpiBar } from "./kpi-bar";

// Colour marks exceptions only (custody breached, bond slashed). Everything that went as
// agreed reads in the text colours, so a problem stands out on a page of good records.
const BOND_LABEL: Record<BondStatus, string> = {
  intact: "Intact",
  released: "Released",
  slashed: "Slashed",
};

export function EngagementCard({ e }: { e: EngagementRecord }) {
  const slashed = e.bond.status === "slashed";
  return (
    <div className="card">
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "center" }}
      >
        <TierBadge tier={e.tier} />
        <span className="muted mono" style={{ fontSize: 12 }}>
          {e.id}
        </span>
      </div>

      <div className="row" style={{ gap: 24, marginTop: 16, marginBottom: 16 }}>
        <Stat label="Epochs met" value={`${e.epochsPassed}/${e.epochsTotal}`} />
        <Stat label="KPI hit-rate" value={`${overallKpiHitRate(e)}%`} />
        <Stat
          label="Custody"
          value={e.custodyIntact ? "Intact" : "Breached"}
          words
          alert={!e.custodyIntact}
        />
      </div>

      <KpiBar label="Depth" pct={e.kpis.depth} />
      <KpiBar label="Uptime" pct={e.kpis.uptime} />
      <KpiBar label="Utilization" pct={e.kpis.utilization} />
      <KpiBar label="No round-trips" pct={e.kpis.noRoundTrips} />

      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginTop: 14,
          paddingTop: 12,
          borderTop: "1px solid var(--border)",
          fontSize: 13,
        }}
      >
        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 2 }}>
            Bond
          </div>
          <span className="mono">{e.bond.posted}</span>
          <span style={{ color: slashed ? "var(--neg)" : "var(--text-muted)" }}>
            {" "}· {BOND_LABEL[e.bond.status]}
          </span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 2 }}>
            Completed
          </div>
          <span className="mono">{e.completedAt}</span>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  words,
  alert,
}: {
  label: string;
  value: string;
  /** A word, not a number: set in the text face rather than tabular figures. */
  words?: boolean;
  /** An exception the reader must notice. */
  alert?: boolean;
}) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 2 }}>
        {label}
      </div>
      <div
        className={words ? undefined : "mono"}
        style={{
          fontSize: 18,
          fontWeight: words ? 500 : undefined,
          color: alert ? "var(--neg)" : "var(--text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
