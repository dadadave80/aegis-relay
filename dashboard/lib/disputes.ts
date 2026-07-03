// Pure disputes logic — refund eligibility mirrors the registry's refund_expired
// gate (Open/InTransit + strict timestamp > escrow_deadline). No React, no server
// deps, so it unit-tests headless and reuses between the panel and any future SSR.
import type { ShipmentView } from "./types";

export type RefundEligibility =
  | { kind: "eligible" }
  | { kind: "before-deadline"; secondsRemaining: number }
  | { kind: "already-expired" }
  | { kind: "not-refundable" };

export function refundEligibility(
  view: ShipmentView | null,
  nowSec: number,
): RefundEligibility {
  if (!view) return { kind: "not-refundable" };
  if (view.state === "EXPIRED") return { kind: "already-expired" };
  if (view.state !== "OPEN" && view.state !== "IN_TRANSIT") {
    return { kind: "not-refundable" };
  }
  // Contract rejects timestamp <= escrow_deadline (DeadlineNotPassed): strict >.
  if (nowSec > view.escrowDeadline) return { kind: "eligible" };
  return { kind: "before-deadline", secondsRemaining: view.escrowDeadline - nowSec };
}

export function fmtRemaining(sec: number): string {
  if (sec <= 0) return "now";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}
