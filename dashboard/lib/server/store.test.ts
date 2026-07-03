import { test, expect, beforeAll, mock } from "bun:test";
import type { ShipRecord, PendingBuild } from "./store";
import type { Listing, ClaimContext } from "../types";

// store.ts starts with `import "server-only"`, which throws when evaluated
// outside a React Server Component graph. Register an empty stub BEFORE the
// module graph loads, then import store dynamically so the stub wins.
mock.module("server-only", () => ({}));

let store: typeof import("./store");
beforeAll(async () => {
  store = await import("./store");
});

test("ship round-trip: put → get (string+number key) → update → listShipIds", async () => {
  const rec = {
    shipmentId: "9001",
    packet: { c_s: "42" },
    meta: { method: "courier", rail: "transparent" },
  } as unknown as ShipRecord;

  await store.putShip(rec);
  expect(await store.getShip("9001")).toEqual(rec);
  expect(await store.getShip(9001)).toEqual(rec); // number key normalizes

  const updated = await store.updateShip("9001", { createdTx: "txabc" });
  expect(updated?.createdTx).toBe("txabc");
  expect((await store.getShip("9001"))?.createdTx).toBe("txabc");
  expect(await store.listShipIds()).toContain("9001");

  expect(await store.updateShip("no-such-ship", {})).toBeUndefined();
  expect(await store.getShip("no-such-ship")).toBeUndefined();
});

test("pending round-trip: put → get → del", async () => {
  const p = { buildId: "b1", action: "create", source: "GABC", xdr: "AAAA" } as unknown as PendingBuild;
  await store.putPending(p);
  expect(await store.getPending("b1")).toEqual(p);
  await store.delPending("b1");
  expect(await store.getPending("b1")).toBeUndefined();
});

test("listing round-trip + open index: created-order + removal", async () => {
  const a: Listing = { shipmentId: 1, amount: "25", method: "courier", laneId: null, escrowDeadline: 100, state: "OPEN", createdAt: 10 };
  const b: Listing = { shipmentId: 2, amount: null, method: "drone", laneId: 7, escrowDeadline: 200, state: "OPEN", createdAt: 20 };
  await store.putListing(a);
  await store.putListing(b);
  expect(await store.getListing(1)).toEqual(a);
  expect(await store.getListing("2")).toEqual(b);
  expect(await store.getListing(999)).toBeUndefined();

  // add out of order; listOpenListings must return ascending by createdAt score
  await store.addOpenListing(2, b.createdAt);
  await store.addOpenListing(1, a.createdAt);
  expect(await store.listOpenListings()).toEqual(["1", "2"]);

  // srem-backed membership: removed id disappears even though the z-index is append-only
  await store.removeOpenListing(1);
  expect(await store.listOpenListings()).toEqual(["2"]);
});

test("reputation + carrier round-trip (defaults + bumps)", async () => {
  const addr = "GCARRIER1";
  expect(await store.getRep(addr)).toEqual({ delivered: 0, expired: 0 });
  await store.bumpRep(addr, "delivered");
  await store.bumpRep(addr, "delivered");
  expect(await store.bumpRep(addr, "expired")).toEqual({ delivered: 2, expired: 1 });
  expect(await store.getRep(addr)).toEqual({ delivered: 2, expired: 1 });

  expect(await store.getCarrier(addr)).toEqual({ credentialed: false });
  await store.setCarrierCredentialed(addr, 1720000000);
  expect(await store.getCarrier(addr)).toEqual({ credentialed: true, onboardedAt: 1720000000 });
});

test("claim context round-trip (seed never stored here)", async () => {
  const ctx: ClaimContext = { shipmentId: 7, carrierPkCommit: "99", destRegion: { cell: "abc" }, tsWindow: 3600 };
  await store.putClaimContext("tok_123", ctx);
  expect(await store.getClaimContext("tok_123")).toEqual(ctx);
  expect(await store.getClaimContext("missing")).toBeUndefined();
});
