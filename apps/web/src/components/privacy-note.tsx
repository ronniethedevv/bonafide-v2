export function PrivacyNote({ children }: { children: string }) {
  return (
    <div
      className="muted"
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        fontSize: 13,
        padding: "12px 16px",
        background: "var(--accent-soft)",
        border: "1px solid color-mix(in srgb, var(--accent) 24%, transparent)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <span aria-hidden="true">{"🔒"}</span>
      <span>{children}</span>
    </div>
  );
}
