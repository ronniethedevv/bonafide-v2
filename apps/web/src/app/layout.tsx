import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { User } from "@/components/icons";
import "./globals.css";

export const metadata: Metadata = {
  title: "MM Reputation",
  description:
    "A private reputation record for crypto market makers. Prove you met your targets without revealing your books.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
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
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">MM Reputation</span>
          </Link>
          <nav className="topnav" aria-label="Main">
            <Link href="/explore">Explore</Link>
            {session?.kind === "mm" && <Link href="/dashboard">My workspace</Link>}
            {session?.kind === "client" && <Link href="/client">My engagements</Link>}
            {!session && (
              <>
                <Link href="/#how">How it works</Link>
                <Link href="/#who-sees-what">Privacy</Link>
              </>
            )}
          </nav>
          <div className="topbar-right">
            {session ? (
              <form action="/api/session" method="post" className="session-chip" title={`Signed in as ${session.name}`}>
                <User size={14} style={{ color: "var(--text-dim)" }} />
                <span className="session-name">{session.name}</span>
                <span className="role">{session.kind === "mm" ? "Market maker" : "Client"}</span>
                <input type="hidden" name="persona" value="signout" />
                <button type="submit">Sign out</button>
              </form>
            ) : (
              <Link href="/signin" className="btn btn-primary btn-sm">Sign in</Link>
            )}
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
