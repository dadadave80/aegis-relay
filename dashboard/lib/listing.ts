// dashboard/lib/listing.ts
// Pure builder for a marketplace board Listing. Deliberately free of any
// "server-only" / crypto imports so it is unit-testable under `bun test` and
// reusable by the /market board. The board shows ONLY on-chain-public metadata:
// the transparent-rail escrow amount is exposed; the confidential-rail amount is
// hidden (null) — spec §9.

import type { Listing, Method, Rail, ShipmentState } from "./types";

export interface ListingInput {
  shipmentId: number;
  rail: Rail;
  method: Method;
  laneId: number | null;
  amountXlm: number;      // merchant's XLM figure; hidden on the confidential rail
  escrowDeadline: number; // unix seconds
  createdAt: number;
  state?: ShipmentState;  // defaults OPEN (create); IN_TRANSIT etc. on sync
  payout?: string;        // bound at accept
}

export function buildListing(inp: ListingInput): Listing {
  return {
    shipmentId: inp.shipmentId,
    amount: inp.rail === "confidential" ? null : String(inp.amountXlm),
    method: inp.method,
    laneId: inp.laneId,
    escrowDeadline: inp.escrowDeadline,
    state: inp.state ?? "OPEN",
    createdAt: inp.createdAt,
    ...(inp.payout ? { payout: inp.payout } : {}),
  };
}
