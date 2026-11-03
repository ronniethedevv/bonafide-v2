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
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <header className="topbar">
          <Link href="/" className="row" style={{ alignItems: "center", gap: 10 }}>
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">MM Reputation</span>
          </Link>
          <span className="pill" style={{ marginLeft: "auto" }}>
            Built on Midnight
          </span>
        </header>
        {children}
      </body>
    </html>
  );
}
