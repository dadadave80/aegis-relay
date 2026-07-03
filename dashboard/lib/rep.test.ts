import { test, expect } from "bun:test";
import { emptyRep, applyRepBump, repSummary } from "./rep";

test("emptyRep starts at zero", () => {
  expect(emptyRep()).toEqual({ delivered: 0, expired: 0 });
});

test("applyRepBump('delivered') increments only delivered", () => {
  expect(applyRepBump({ delivered: 2, expired: 1 }, "delivered")).toEqual({ delivered: 3, expired: 1 });
});

test("applyRepBump('expired') increments only expired", () => {
  expect(applyRepBump({ delivered: 2, expired: 1 }, "expired")).toEqual({ delivered: 2, expired: 2 });
});

test("applyRepBump is pure (does not mutate input)", () => {
  const rep = { delivered: 5, expired: 0 };
  applyRepBump(rep, "expired");
  expect(rep).toEqual({ delivered: 5, expired: 0 });
});

test("applyRepBump composes over a full history", () => {
  let r = emptyRep();
  for (const k of ["delivered", "delivered", "expired", "delivered"] as const) r = applyRepBump(r, k);
  expect(r).toEqual({ delivered: 3, expired: 1 });
});

test("repSummary on empty history is fresh/new with zero rate", () => {
  const s = repSummary({ delivered: 0, expired: 0 });
  expect(s.total).toBe(0);
  expect(s.fresh).toBe(true);
  expect(s.pct).toBe(0);
  expect(s.tier).toBe("new");
});

test("repSummary computes success rate + pct", () => {
  const s = repSummary({ delivered: 3, expired: 1 });
  expect(s.total).toBe(4);
  expect(s.rate).toBeCloseTo(0.75, 5);
  expect(s.pct).toBe(75);
  expect(s.fresh).toBe(false);
  expect(s.tier).toBe("fair");
});

test("repSummary tiers: good >=90, fair >=60, poor <60", () => {
  expect(repSummary({ delivered: 9, expired: 1 }).tier).toBe("good"); // 90%
  expect(repSummary({ delivered: 6, expired: 4 }).tier).toBe("fair"); // 60%
  expect(repSummary({ delivered: 1, expired: 4 }).tier).toBe("poor"); // 20%
});

test("repSummary sanitizes negative / fractional counters", () => {
  const s = repSummary({ delivered: -3, expired: 2.9 });
  expect(s.delivered).toBe(0);
  expect(s.expired).toBe(2);
  expect(s.total).toBe(2);
});
