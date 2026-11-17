import type { ReactNode } from "react";
import { Lock, Unlock } from "@/components/icons";

export function PrivacyNote({ children, open = false }: { children: ReactNode; open?: boolean }) {
  return (
    <div
      className="muted"
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        fontSize: 13,
        lineHeight: 1.55,
        padding: "12px 16px",
        background: "var(--accent-soft)",
        border: "1px solid color-mix(in srgb, var(--accent) 24%, transparent)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <span style={{ color: "var(--accent-2)", marginTop: 1, display: "inline-flex" }}>
        {open ? <Unlock size={16} /> : <Lock size={16} />}
      </span>
      <span>{children}</span>
    </div>
  );
}
