import type { Freshness } from "@/lib/read-model";

const TONE: Record<Freshness, { color: string; label: string }> = {
  fresh: { color: "var(--pos)", label: "fresh" },
  ageing: { color: "var(--warn)", label: "ageing" },
  stale: { color: "var(--text-dim)", label: "stale" },
};

function daysAgo(iso: string): string {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "1 day ago";
  if (d < 30) return `${d} days ago`;
  const m = Math.floor(d / 30);
  return m === 1 ? "1 month ago" : `${m} months ago`;
}

/** Shows how current a record is — its most recent engagement and a freshness tone. */
export function FreshnessChip({ freshness, lastAt }: { freshness: Freshness; lastAt: string }) {
  const tone = TONE[freshness];
  return (
    <span
      className="pill"
      title={`Most recent engagement completed ${lastAt}`}
      style={{ gap: 7 }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: "999px",
          background: tone.color,
          display: "inline-block",
        }}
      />
      Updated {daysAgo(lastAt)} · {tone.label}
    </span>
  );
}
