// Pure, client-safe board helpers — filtering + new-listing diffing for the
// /market board. No @stellar/stellar-sdk and no server imports (contract.ts is
// server-only), so this module is safe in the client bundle AND under bun test.
import type { Listing, Method } from "@/lib/types";

export interface BoardFilters {
  /** null = any lane. */
  laneId: number | null;
  /** null = any; when set, confidential (null-amount) rows are dropped. XLM units. */
  minAmount: number | null;
  method: Method | "all";
  /** null = any; keep only deadlines at most `now + withinHours*3600`. */
  withinHours: number | null;
}

export const EMPTY_FILTERS: BoardFilters = {
  laneId: null,
  minAmount: null,
  method: "all",
  withinHours: null,
};

/** Apply the board filters. Pure — `nowSec` is injected so tests are deterministic. */
export function filterListings(listings: Listing[], f: BoardFilters, nowSec: number): Listing[] {
  return listings.filter((l) => {
    if (f.laneId !== null && l.laneId !== f.laneId) return false;
    if (f.method !== "all" && l.method !== f.method) return false;
    if (f.minAmount !== null) {
      if (l.amount === null) return false; // confidential rail hides the escrow
      if (Number(l.amount) < f.minAmount) return false;
    }
    if (f.withinHours !== null && l.escrowDeadline > nowSec + f.withinHours * 3600) return false;
    return true;
  });
}

/**
 * Ids present in `next` but not in `prev`. `prev === null` (the first
 * observation) returns [] so the initial board load never bursts a toast per
 * pre-existing row — only genuinely new listings notify.
 */
export function newlyAppeared(prevIds: number[] | null, nextIds: number[]): number[] {
  if (prevIds === null) return [];
  const prev = new Set(prevIds);
  return nextIds.filter((id) => !prev.has(id));
}

/** YYYY-MM-DD (UTC) for a unix-seconds deadline — client-safe (no SDK). */
export function utcDay(tsSec: number): string {
  return new Date(tsSec * 1000).toISOString().slice(0, 10);
}
