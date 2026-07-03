import { test, expect } from "bun:test";
import { buildListing } from "./listing";

test("transparent listing exposes the XLM amount and starts OPEN", () => {
  const l = buildListing({
    shipmentId: 42,
    rail: "transparent",
    method: "courier",
    laneId: null,
    amountXlm: 25,
    escrowDeadline: 1_800_000_000,
    createdAt: 1_700_000_000_000,
  });
  expect(l).toEqual({
    shipmentId: 42,
    amount: "25",
    method: "courier",
    laneId: null,
    escrowDeadline: 1_800_000_000,
    state: "OPEN",
    createdAt: 1_700_000_000_000,
  });
});

test("confidential listing hides the amount (null)", () => {
  const l = buildListing({
    shipmentId: 7,
    rail: "confidential",
    method: "courier",
    laneId: null,
    amountXlm: 999, // private figure — must NOT surface on the board
    escrowDeadline: 1_800_000_000,
    createdAt: 1_700_000_000_001,
  });
  expect(l.amount).toBeNull();
  expect(l.state).toBe("OPEN");
});

test("drone listing carries the lane id; payout omitted until accept", () => {
  const l = buildListing({
    shipmentId: 3,
    rail: "transparent",
    method: "drone",
    laneId: 7,
    amountXlm: 50,
    escrowDeadline: 1_800_000_000,
    createdAt: 1_700_000_000_002,
  });
  expect(l.laneId).toBe(7);
  expect(l.method).toBe("drone");
  expect("payout" in l).toBe(false);
});

test("payout is included when provided (accept-time listing)", () => {
  const l = buildListing({
    shipmentId: 9,
    rail: "transparent",
    method: "courier",
    laneId: null,
    amountXlm: 10,
    escrowDeadline: 1_800_000_000,
    createdAt: 1_700_000_000_003,
    state: "IN_TRANSIT",
    payout: "GAAA",
  });
  expect(l.state).toBe("IN_TRANSIT");
  expect(l.payout).toBe("GAAA");
});
