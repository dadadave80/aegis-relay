import { test, expect } from "bun:test";
import { filterListings, newlyAppeared, EMPTY_FILTERS, type BoardFilters } from "./board";
import type { Listing } from "@/lib/types";

const L = (o: Partial<Listing> & { shipmentId: number }): Listing => ({
  amount: "100",
  method: "courier",
  laneId: 7,
  escrowDeadline: 2_000_000_000,
  state: "OPEN",
  createdAt: 1_700_000_000,
  ...o,
});
const NOW = 1_700_000_000;

test("filterListings: EMPTY_FILTERS keeps everything", () => {
  const ls = [L({ shipmentId: 1 }), L({ shipmentId: 2, method: "drone" })];
  expect(filterListings(ls, EMPTY_FILTERS, NOW).map((l) => l.shipmentId)).toEqual([1, 2]);
});

test("filterListings: laneId narrows to the lane", () => {
  const ls = [L({ shipmentId: 1, laneId: 7 }), L({ shipmentId: 2, laneId: 3 })];
  const f: BoardFilters = { ...EMPTY_FILTERS, laneId: 7 };
  expect(filterListings(ls, f, NOW).map((l) => l.shipmentId)).toEqual([1]);
});

test("filterListings: method narrows; minAmount drops smaller AND confidential(null) rows", () => {
  const ls = [
    L({ shipmentId: 1, amount: "50" }),
    L({ shipmentId: 2, amount: "150" }),
    L({ shipmentId: 3, amount: null }),
  ];
  const f: BoardFilters = { ...EMPTY_FILTERS, minAmount: 100 };
  expect(filterListings(ls, f, NOW).map((l) => l.shipmentId)).toEqual([2]);
});

test("filterListings: withinHours drops deadlines beyond now+window", () => {
  const soon = NOW + 3600;
  const far = NOW + 100 * 3600;
  const ls = [L({ shipmentId: 1, escrowDeadline: soon }), L({ shipmentId: 2, escrowDeadline: far })];
  const f: BoardFilters = { ...EMPTY_FILTERS, withinHours: 24 };
  expect(filterListings(ls, f, NOW).map((l) => l.shipmentId)).toEqual([1]);
});

test("newlyAppeared: first observation (null prev) never bursts a toast", () => {
  expect(newlyAppeared(null, [1, 2, 3])).toEqual([]);
});

test("newlyAppeared: returns only ids new since the last poll", () => {
  expect(newlyAppeared([1, 2], [2, 3, 4])).toEqual([3, 4]);
  expect(newlyAppeared([1, 2, 3], [1, 2, 3])).toEqual([]);
});
