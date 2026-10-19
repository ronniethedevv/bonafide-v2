export function PrivacyNote({ children }: { children: string }) {
  return (
    <div
      className="muted"
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        fontSize: 13,
        padding: "10px 14px",
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
      }}
    >
      <span aria-hidden="true">{"🔒"}</span>
      <span>{children}</span>
    </div>
  );
}
