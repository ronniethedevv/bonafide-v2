import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

// One small stroke-icon set (24×24 grid, currentColor) so arrows, checks and locks
// align with text everywhere instead of relying on font glyphs (→ ✓ 🔒), which render
// at inconsistent sizes and baselines across platforms.

interface IconProps {
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
}

function Svg({ size = 16, strokeWidth = 2, style, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ display: "inline-block", flexShrink: 0, verticalAlign: "-0.15em", ...style }}
    >
      {children}
    </svg>
  );
}

export const ArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </Svg>
);

export const ArrowLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 12H5" />
    <path d="m11 18-6-6 6-6" />
  </Svg>
);

export const ChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const Check = (p: IconProps) => (
  <Svg strokeWidth={2.6} {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);

export const Lock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Svg>
);

export const Unlock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 7.5-2" />
  </Svg>
);

export const User = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Svg>
);

export const Info = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" />
  </Svg>
);

export const Plus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Svg>
);

export const Eye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const Globe = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" />
  </Svg>
);

export const Shield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);

/** Filled shapes for tier badges (shape + label, never colour alone). */
export function TierShape({ tier, size = 10 }: { tier: "A" | "B" | "C"; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 10 10", "aria-hidden": true as const, style: { display: "inline-block", flexShrink: 0 } };
  if (tier === "A") return <svg {...common}><path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" fill="currentColor" /></svg>;
  if (tier === "B") return <svg {...common}><path d="M5 1 9.3 9H0.7Z" fill="currentColor" /></svg>;
  return <svg {...common}><circle cx="5" cy="5" r="4" fill="currentColor" /></svg>;
}

/** A back link ("← Workspace") with a properly aligned arrow. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="backlink">
      <ArrowLeft size={15} />
      <span>{children}</span>
    </Link>
  );
}

/** "a → b → c" sequence with aligned arrow icons between the steps. */
export function Flow({ steps, size = 12 }: { steps: readonly string[]; size?: number }) {
  return (
    <span className="flow">
      {steps.map((s, i) => (
        <span key={s} className="flow-step">
          {i > 0 && <ArrowRight size={size} style={{ opacity: 0.7 }} />}
          <span>{s}</span>
        </span>
      ))}
    </span>
  );
}
