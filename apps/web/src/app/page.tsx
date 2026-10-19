import Link from "next/link";
import { listProfiles } from "@/lib/fixtures.js";
import { totalCompleted } from "@/lib/read-model.js";

export default function HomePage() {
  const profiles = listProfiles();
  return (
    <main className="container">
      <h1 style={{ marginBottom: 4 }}>MM Reputation Record</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Verified market-maker performance, proven with zero-knowledge — no account
        access, no books handed over.
      </p>

      <h2 style={{ marginTop: 32 }}>Market makers</h2>
      <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
        {profiles.map((p) => (
          <Link key={p.handle} href={`/mm/${p.handle}`} className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
              <strong>{p.displayName}</strong>
              <span className="muted mono">@{p.handle}</span>
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              {totalCompleted(p)} completed engagements · {p.headlineUptime}% headline uptime
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
