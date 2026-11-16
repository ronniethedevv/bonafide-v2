import type { Coverage } from "@/lib/read-model";

const CHAIN_NAMES: Record<number, string> = { 1: "Ethereum", 8453: "Base" };

/**
 * Honest scope disclosure — what this record covers and what it does not. Surfacing
 * this is a deliberate product stance: the public engagements are self-selected, so the
 * record is not a complete trading history, and we say so rather than imply completeness.
 */
export function CoverageNote({ coverage }: { coverage: Coverage }) {
  const chains = coverage.chains.map((c) => CHAIN_NAMES[c] ?? `chain ${c}`).join(" · ");
  const venues = coverage.venues.join(", ");
  return (
    <div
      className="card"
      style={{ padding: "16px 20px", background: "var(--surface)" }}
    >
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        What this record covers
      </div>
      <div
        className="row"
        style={{ gap: 20, marginBottom: 10, fontSize: 13 }}
      >
        {chains && (
          <span className="muted">
            Chains: <span style={{ color: "var(--text)" }}>{chains}</span>
          </span>
        )}
        {venues && (
          <span className="muted">
            Venues: <span style={{ color: "var(--text)" }}>{venues}</span>
          </span>
        )}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
        {coverage.note}
      </p>
    </div>
  );
}
