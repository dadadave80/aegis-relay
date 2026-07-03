import { test, expect, beforeAll, mock } from "bun:test";
import type { ShipRecord } from "./store";
import type { ClaimContext } from "../types";

// store.ts / flows.ts / soroban.ts all start with `import "server-only"`, which
// throws when evaluated outside a React Server Component graph (same trick as
// store.test.ts). Stub it BEFORE the module graph loads.
mock.module("server-only", () => ({}));

// On-chain registry `deliver` enforces |now - ts| <= WINDOW_SEC (600s) —
// contracts/aegis-registry. Mirrored here so the test's tolerance matches the
// real on-chain freshness gate, not an arbitrary number.
const WINDOW_SEC = 600;

let store: typeof import("./store");
let flows: typeof import("./flows");

beforeAll(async () => {
  // claimContextFlow's fresh-ts logic calls readShipmentRaw (a live Soroban RPC
  // read) to clamp ts strictly after accept_ts. Stub it to "not found" so the
  // test is hermetic/fast and doesn't depend on network access; the function
  // already degrades gracefully to `now` when the RPC read isn't `ok`.
  const sorobanActual = await import("./soroban");
  mock.module("./soroban", () => ({
    ...sorobanActual,
    readShipmentRaw: async () => ({ ok: false as const, reason: "notfound" as const }),
  }));

  store = await import("./store");
  flows = await import("./flows");
});

test("claimContextFlow returns a FRESH tsWindow even when a stored-complete ClaimContext carries a far-future placeholder (StaleTs regression)", async () => {
  const shipmentId = 555001;

  // A COMPLETE stored context (carrierPkCommit bound + destRegion reshaped to
  // {lat,lon,cellRd}) — the real create+accept flow always produces this shape.
  // tsWindow here is the create-time placeholder: Number(meta.escrowDeadline),
  // which rounds up to the next whole-day boundary — hours-to-a-day in the
  // future, exactly the value that must NEVER be served back verbatim.
  const farFutureTs = Math.floor(Date.now() / 1000) + 90_000; // ~25h out
  const stored: ClaimContext = {
    shipmentId,
    carrierPkCommit: "999",
    destRegion: { lat: 6.5244, lon: 3.3792, cellRd: "12920082684" },
    tsWindow: farFutureTs,
  };
  await store.putClaimContext(String(shipmentId), stored);

  // The ship record backing this context (also needed on the fall-through path;
  // harmless here since the stored-complete branch should short-circuit before
  // touching it for anything but carrierPkCommit/destRegion).
  await store.putShip({
    shipmentId: String(shipmentId),
    packet: { c_s: "42" },
    meta: { method: "courier", rail: "transparent", toLat: 6.5244, toLon: 3.3792 },
    carrierBJJ: { seedHex: "aa", pkX: "1", pkY: "2", pkBlind: "3", commit: "999" },
  } as unknown as ShipRecord);

  const ctx = await flows.claimContextFlow(shipmentId);

  const now = Math.floor(Date.now() / 1000);
  expect(Math.abs(ctx.tsWindow - now)).toBeLessThanOrEqual(WINDOW_SEC);
  // must NOT be the stale stored placeholder
  expect(ctx.tsWindow).not.toBe(farFutureTs);
  // the stored carrier/dest fields still carry through untouched
  expect(ctx.carrierPkCommit).toBe("999");
  expect(ctx.destRegion).toEqual({ lat: 6.5244, lon: 3.3792, cellRd: "12920082684" });
});
