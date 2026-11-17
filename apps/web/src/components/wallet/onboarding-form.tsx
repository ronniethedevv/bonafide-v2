"use client";

import { useState } from "react";
import { slugify } from "@/lib/auth/shared";
import { ArrowRight, Eye, Lock } from "@/components/icons";

type Role = "mm" | "client";

const ROLES: Array<{ role: Role; title: string; body: string; icon: React.ReactNode }> = [
  { role: "mm", title: "I'm a market maker", body: "Register engagements, prove each epoch, build a public record.", icon: <Lock size={18} /> },
  { role: "client", title: "I hire market makers", body: "Follow your engagements' real figures, verify and dispute.", icon: <Eye size={18} /> },
];

export function OnboardingForm({ next }: { next: string | undefined }) {
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleEdited, setHandleEdited] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const effectiveHandle = handleEdited ? handle : slugify(name);
  // Editing a field clears its error (and the name drives the suggested handle).
  const clear = (...keys: string[]) =>
    setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !keys.includes(k) && k !== "form")));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!role) return setErrors({ role: "Choose one." });
    setBusy(true);
    setErrors({});
    try {
      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, name, handle: effectiveHandle, next }),
      });
      const body = (await res.json()) as { ok?: boolean; next?: string; errors?: Record<string, string>; error?: string };
      if (res.ok && body.ok && body.next) return window.location.assign(body.next);
      setErrors(body.errors ?? { form: body.error ?? "Couldn't create the account." });
    } catch {
      setErrors({ form: "Network error. Please try again." });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="card" style={{ padding: 24, marginTop: 20 }}>
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="eyebrow" style={{ marginBottom: 10 }}>Which are you?</legend>
        <div className="cols-2">
          {ROLES.map((r) => (
            <label key={r.role} className={`role-card${role === r.role ? " is-selected" : ""}`}>
              <input type="radio" name="role" value={r.role} checked={role === r.role} onChange={() => { setRole(r.role); clear("role"); }} />
              <span className="view-icon" aria-hidden="true">{r.icon}</span>
              <span>
                <span style={{ display: "block", fontWeight: 600, color: "var(--text-high)" }}>{r.title}</span>
                <span className="dim" style={{ display: "block", fontSize: 12.5, marginTop: 3, lineHeight: 1.5 }}>{r.body}</span>
              </span>
            </label>
          ))}
        </div>
        {errors.role && <div className="field-err">{errors.role}</div>}
      </fieldset>

      {role && (
        <div style={{ display: "grid", gap: 16, marginTop: 22 }}>
          <label style={{ display: "block" }}>
            <span className="field-label">{role === "mm" ? "Firm name (public)" : "Organisation name"}</span>
            <input className="inp" value={name} onChange={(e) => { setName(e.target.value); clear("name", ...(handleEdited ? [] : ["handle"])); }} placeholder={role === "mm" ? "e.g. Acme Liquidity" : "e.g. Nova Foundation"} maxLength={60} autoFocus />
            {errors.name && <div className="field-err">{errors.name}</div>}
          </label>
          {role === "mm" && (
            <label style={{ display: "block" }}>
              <span className="field-label">Public handle</span>
              <input
                className="inp mono"
                value={effectiveHandle}
                onChange={(e) => {
                  setHandleEdited(true);
                  setHandle(e.target.value.toLowerCase());
                  clear("handle");
                }}
                placeholder="acme-liquidity"
                maxLength={30}
              />
              <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>Your public record will live at /mm/{effectiveHandle || "your-handle"}.</div>
              {errors.handle && <div className="field-err">{errors.handle}</div>}
            </label>
          )}
          {role === "client" && (
            <p className="dim" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.55 }}>
              Your name is only shown to the market makers you work with. It never appears on a public record.
            </p>
          )}
        </div>
      )}

      {errors.form && <div className="field-err" role="alert">{errors.form}</div>}

      <button type="submit" className="btn btn-primary link-arrow" style={{ marginTop: 22 }} disabled={!role || busy}>
        <span>{busy ? "Creating…" : "Create account"}</span>
        <ArrowRight size={16} />
      </button>
    </form>
  );
}
