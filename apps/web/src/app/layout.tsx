import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "MM Reputation Record",
  description:
    "Verified, privacy-preserving performance records for crypto market makers.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Inter at runtime (no build-time font fetch, keeps CI builds offline-safe). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;650;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <header className="topbar">
          <Link href="/" className="row" style={{ alignItems: "center", gap: 10 }}>
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">MM Reputation</span>
          </Link>
          <span className="pill muted" style={{ marginLeft: "auto", fontSize: 12 }}>
            ZK · Midnight
          </span>
        </header>
        {children}
      </body>
    </html>
  );
}
