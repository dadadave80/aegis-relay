// Pure reputation math + display derivation. Shared (no "use client"/"server-only"),
// like components/ds/Stamp — imported by the store-fed chip AND mirrored by the
// server's store.bumpRep. applyRepBump is THE canonical increment; keeping it here
// (not inline in the store) makes the "delivered vs expired" rule test-covered once.
import type { Reputation } from "./types";

/** Zero reputation — a carrier with no terminal history yet. */
export function emptyRep(): Reputation {
  return { delivered: 0, expired: 0 };
}

/**
 * Canonical reputation increment. A terminal DELIVERED (settle) bumps `delivered`;
 * a terminal EXPIRED (refund-on-deadline) bumps `expired`. Pure — returns a fresh
 * object, never mutates. store.bumpRep persists exactly this transition.
 */
export function applyRepBump(rep: Reputation, kind: "delivered" | "expired"): Reputation {
  return kind === "delivered"
    ? { delivered: rep.delivered + 1, expired: rep.expired }
    : { delivered: rep.delivered, expired: rep.expired + 1 };
}

export interface RepSummary {
  delivered: number;
  expired: number;
  total: number;
  /** Success rate in [0,1]; 0 when there is no history yet. */
  rate: number;
  /** Whole-percent success rate for display (0 when no history). */
  pct: number;
  /** true when the carrier has zero terminal history. */
  fresh: boolean;
  /** Coarse standing bucket that drives the chip tone. */
  tier: "new" | "poor" | "fair" | "good";
}

/** Derive the display summary from raw counters. Pure; tolerant of dirty input. */
export function repSummary(rep: Reputation): RepSummary {
  const delivered = Math.max(0, Math.floor(rep.delivered));
  const expired = Math.max(0, Math.floor(rep.expired));
  const total = delivered + expired;
  const rate = total === 0 ? 0 : delivered / total;
  const pct = Math.round(rate * 100);
  const fresh = total === 0;
  const tier: RepSummary["tier"] = fresh ? "new" : pct >= 90 ? "good" : pct >= 60 ? "fair" : "poor";
  return { delivered, expired, total, rate, pct, fresh, tier };
}
