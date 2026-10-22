import type { EngagementRecord, BondStatus } from "@/lib/read-model";
import { overallKpiHitRate } from "@/lib/read-model";
import { TierBadge } from "./tier-badge";
import { KpiBar } from "./kpi-bar";

const BOND_COLOR: Record<BondStatus, string> = {
  intact: "var(--text-muted)",
  released: "var(--pos)",
  slashed: "var(--neg)",
};

export function EngagementCard({ e }: { e: EngagementRecord }) {
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

      <div className="row" style={{ gap: 24, marginTop: 14, marginBottom: 14 }}>
        <Stat label="Epochs met" value={`${e.epochsPassed}/${e.epochsTotal}`} />
        <Stat label="KPI hit-rate" value={`${overallKpiHitRate(e)}%`} />
        <Stat
          label="Custody"
          value={e.custodyIntact ? "Intact" : "Breached"}
          tone={e.custodyIntact ? "var(--pos)" : "var(--neg)"}
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
          marginTop: 14,
          paddingTop: 12,
          borderTop: "1px solid var(--border)",
          fontSize: 13,
        }}
      >
        <span className="muted">
          Bond:{" "}
          <span className="mono" style={{ color: BOND_COLOR[e.bond.status] }}>
            {e.bond.posted} · {e.bond.status}
          </span>
        </span>
        <span className="muted mono">{e.completedAt}</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 2 }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 18, color: tone ?? "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}
