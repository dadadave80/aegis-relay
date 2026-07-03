import type { CSSProperties, ReactNode } from "react";

/**
 * STAMP — the classification-label atom (Aegis Relay Design System).
 * Uppercase Archivo Expanded, +12% tracking. Rail labels: SEALED ·
 * PUBLIC BY DESIGN · VERIFIED ON-CHAIN · AUDITOR VIEW.
 */
export type StampTone = "dim" | "ink" | "chain" | "seal" | "verified" | "caution" | "danger";

const TONES: Record<StampTone, string> = {
  dim: "var(--ink-dim)",
  ink: "var(--ink)",
  chain: "var(--chain-dim)",
  seal: "var(--seal)",
  verified: "var(--verified)",
  caution: "var(--caution)",
  danger: "var(--danger)",
};

export function Stamp({
  children,
  tone = "dim",
  style,
}: {
  children: ReactNode;
  tone?: StampTone;
  style?: CSSProperties;
}) {
  return (
    <span className="stamp" style={{ color: TONES[tone], ...style }}>
      {children}
    </span>
  );
}
