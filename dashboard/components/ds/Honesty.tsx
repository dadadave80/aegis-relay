import type { ReactNode } from "react";

/**
 * <Honesty> — the annotation voice (Aegis Relay Design System). Amber IBM Plex
 * Mono true italic, for trust-anchor caveats kept verbatim: the simulated
 * secure element, the unaudited confidential rail, the demo-signing note.
 */
export function Honesty({ children }: { children: ReactNode }) {
  return (
    <p
      className="honesty"
      style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: 0 }}
    >
      <span aria-hidden style={{ fontStyle: "normal" }}>⚠</span>
      <span>{children}</span>
    </p>
  );
}
