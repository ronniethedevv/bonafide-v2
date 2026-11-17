import { redirect } from "next/navigation";
import { getAuth, homeOf, safeNext } from "@/lib/session";
import { shortAddress } from "@/lib/auth/shared";
import { OnboardingForm } from "@/components/wallet/onboarding-form";
import { Info } from "@/components/icons";

export const metadata = { title: "Set up your account · MM Reputation" };

// First wallet sign-in: link the wallet to a new market-maker or client account.
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [{ next }, auth] = await Promise.all([searchParams, getAuth()]);
  if (auth.session) redirect(homeOf(auth.session));
  if (!auth.pendingWallet) redirect("/signin");

  return (
    <main className="container" style={{ maxWidth: 720 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>Welcome</div>
      <h1 style={{ margin: 0, fontSize: "clamp(28px, 4vw, 40px)" }}>Set up your account</h1>
      <p className="muted" style={{ fontSize: 14, margin: "10px 0 0", lineHeight: 1.6 }}>
        Signed in as <span className="mono" style={{ color: "var(--text-high)" }}>{shortAddress(auth.pendingWallet.address)}</span>.
        This wallet isn&apos;t linked to an account yet.
      </p>

      <OnboardingForm next={safeNext(next)} />

      <div className="demo-note" style={{ marginTop: 16, alignItems: "flex-start" }}>
        <Info size={14} style={{ marginTop: 2 }} />
        <span style={{ lineHeight: 1.55 }}>
          Preview: no database is connected yet, so this account is saved in this browser only.
          Signing in from another device will ask you to set it up again.
        </span>
      </div>
    </main>
  );
}
