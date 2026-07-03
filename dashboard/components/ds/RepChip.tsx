import type { CSSProperties } from "react";
import type { Reputation } from "@/lib/types";
import { repSummary } from "@/lib/rep";
import { Stamp } from "./Stamp";

const TIER_COLOR: Record<"new" | "poor" | "fair" | "good", string> = {
  new: "var(--ink-dim)",
  poor: "var(--danger)",
  fair: "var(--caution)",
  good: "var(--verified)",
};

/**
 * <RepChip> — carrier reputation as a compact instrument chip (Aegis Relay DS).
 * Success-rate tier from delivered/expired counters; monospace numerals, hairline
 * border, tier-colored value. "NEW" for a carrier with no terminal history yet.
 */
export function RepChip({ rep, style }: { rep: Reputation; style?: CSSProperties }) {
  const s = repSummary(rep);
  return (
    <span
      className="mono"
      title={`${s.delivered} delivered · ${s.expired} expired`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--r-control)",
        fontSize: "var(--text-xs)",
        background: "var(--void-0)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <Stamp tone="dim">REP</Stamp>
      <span style={{ color: TIER_COLOR[s.tier] }}>
        {s.fresh ? "NEW" : `${s.pct}% · ${s.delivered}/${s.total}`}
      </span>
    </span>
  );
}
