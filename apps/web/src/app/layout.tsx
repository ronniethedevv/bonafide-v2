import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "MM Reputation",
  description:
    "A private reputation record for crypto market makers. Prove you met your targets without revealing your books.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Fonts at runtime (no build-time fetch, keeps CI builds offline-safe). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <header className="topbar">
          <Link href="/" className="row" style={{ alignItems: "center", gap: 10 }}>
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">MM Reputation</span>
          </Link>
          <nav className="row topnav" style={{ marginLeft: 28, gap: 20, alignItems: "center" }}>
            <Link href="/" className="muted" style={{ fontSize: 14 }}>Explore</Link>
            <Link href="/dashboard" className="muted" style={{ fontSize: 14 }}>Dashboard</Link>
            <Link href="/client" className="muted" style={{ fontSize: 14 }}>Client</Link>
          </nav>
          <span className="pill topbar-pill" style={{ marginLeft: "auto" }}>
            Built on Midnight
          </span>
        </header>
        {children}
      </body>
    </html>
  );
}
