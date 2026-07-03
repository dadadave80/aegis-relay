import { test, expect } from "bun:test";
import { refundEligibility, fmtRemaining } from "./disputes";
import type { ShipmentView } from "./types";

function view(p: Partial<ShipmentView>): ShipmentView {
  return {
    id: 1, state: "OPEN", method: "courier", rail: "transparent",
    laneId: null, cs: "0", head: null, amountXlm: "25", paidXlm: "0",
    flightOk: false, escrowDeadline: 1000, payout: null, ...p,
  };
}

test("null view is not refundable", () => {
  expect(refundEligibility(null, 2000).kind).toBe("not-refundable");
});
test("OPEN past deadline is eligible", () => {
  expect(refundEligibility(view({ state: "OPEN", escrowDeadline: 1000 }), 2000)).toEqual({ kind: "eligible" });
});
test("IN_TRANSIT past deadline is eligible", () => {
  expect(refundEligibility(view({ state: "IN_TRANSIT", escrowDeadline: 1000 }), 2000).kind).toBe("eligible");
});
test("OPEN before deadline reports remaining seconds", () => {
  expect(refundEligibility(view({ state: "OPEN", escrowDeadline: 5000 }), 2000)).toEqual({ kind: "before-deadline", secondsRemaining: 3000 });
});
test("boundary: exactly at deadline is not yet eligible (contract uses strict >)", () => {
  expect(refundEligibility(view({ state: "OPEN", escrowDeadline: 2000 }), 2000).kind).toBe("before-deadline");
});
test("EXPIRED is already-expired", () => {
  expect(refundEligibility(view({ state: "EXPIRED" }), 2000).kind).toBe("already-expired");
});
test("DELIVERED is not refundable", () => {
  expect(refundEligibility(view({ state: "DELIVERED" }), 2000).kind).toBe("not-refundable");
});
test("UNKNOWN is not refundable", () => {
  expect(refundEligibility(view({ state: "UNKNOWN" }), 9999).kind).toBe("not-refundable");
});
test("fmtRemaining formats h/m/s", () => {
  expect(fmtRemaining(3720)).toBe("1h 2m");
  expect(fmtRemaining(120)).toBe("2m");
  expect(fmtRemaining(45)).toBe("45s");
  expect(fmtRemaining(0)).toBe("now");
});
