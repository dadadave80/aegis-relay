/**
 * dashboard/lib/contract.ts
 *
 * Read-only helpers for the Aegis Relay contracts on Stellar testnet.
 * Server-only (Server Components). All reads use simulateTransaction —
 * no signing, no keys, no state changes.
 *
 * Strategy (proven in the v1 donor dashboard): build the transaction XDR with
 * the stellar SDK, POST it to the JSON-RPC endpoint via fetch, decode the
 * returned XDR. The testnet RPC flaps — every public helper is designed to
 * be wrapped in .catch() by callers and additionally times out its fetches,
 * so a page render can never hang or hard-fail on RPC weather.
 */

import {
  Account,
  Contract,
  Networks,
  TransactionBuilder,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

// ── Contract IDs (testnet defaults, overridable via NEXT_PUBLIC_*) ───────────

export const REGISTRY_ID =
  process.env.NEXT_PUBLIC_REGISTRY_ID ??
  "CAROLAUWCNZGSLSAISY5OVY5GZDZ6ULPBAO3U4FKTU3OIAOVPO6ZKPZL";

export const AIRSPACE_ID =
  process.env.NEXT_PUBLIC_AIRSPACE_ID ??
  "CCOEGSF3BSLXYKZMMX2OCSOJONAGORRWSI33TIUX3EHPVVHNMVHNENOY";

export const CREDENTIALS_ID =
  process.env.NEXT_PUBLIC_CREDENTIALS_ID ??
  "CBEDJCSBU3IKHW34HAZPL55CFJ5AZOTBJUGFXR5TS5JMRJN7W37K4FQF";

export const NATIVE_SAC =
  process.env.NEXT_PUBLIC_NATIVE_SAC ??
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

export const TESTNET_RPC =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org";

export function explorer(contractId: string): string {
  return `https://stellar.expert/explorer/testnet/contract/${contractId}`;
}

// A valid ed25519 public key (not funded) used only to build simulation txs.
const DUMMY_PK = "GC5Z644P4L2WUHLAK37KAO6OWF6NH3DUIH3Y5EVOQWHQ2BSHBBCE4NWN";

/** Every RPC round-trip is capped so a flapping endpoint degrades, not hangs. */
const FETCH_TIMEOUT_MS = 8_000;

// ── Core: build tx XDR → simulateTransaction → decode result ─────────────────

async function rpc(body: Record<string, unknown>): Promise<unknown> {
  const resp = await fetch(TESTNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
  } as RequestInit);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from RPC`);
  return resp.json();
}

/**
 * Simulate `method(args)` on `contractId`. Returns the retval ScVal.
 * Throws SimulateError on a contract-level error (e.g. Error(Contract, #11)),
 * a plain Error on transport failure.
 */
export class SimulateError extends Error {
  constructor(public detail: string) {
    super(detail);
  }
}

async function simulate(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<xdr.ScVal | null> {
  const account = new Account(DUMMY_PK, "0");
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const json = (await rpc({
    method: "simulateTransaction",
    params: { transaction: tx.toXDR() },
  })) as {
    result?: { results?: Array<{ xdr: string }>; error?: string };
    error?: { message: string };
  };

  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  if (json.result?.error) throw new SimulateError(json.result.error);

  const retvalXdr = json.result?.results?.[0]?.xdr;
  if (!retvalXdr) return null;
  return xdr.ScVal.fromXDR(retvalXdr, "base64");
}

// ── Registry: status(id) ─────────────────────────────────────────────────────

export type StateName = "OPEN" | "IN_TRANSIT" | "DELIVERED" | "EXPIRED";
export const STATE_NAMES: StateName[] = [
  "OPEN",
  "IN_TRANSIT",
  "DELIVERED",
  "EXPIRED",
];

export type MethodName = "COURIER" | "LOCKER" | "DRONE";
export const METHOD_NAMES: Record<number, MethodName> = {
  1: "COURIER",
  2: "LOCKER",
  3: "DRONE",
};

/** Decoded `Shipment` record from `aegis-registry::status(id)`. */
export interface ShipmentView {
  id: number;
  cS: string; // opaque commitment, decimal string
  state: number;
  stateName: StateName;
  merchant: string;
  token: string;
  amount: string; // i128, decimal string
  milestones: number[]; // bps
  paid: string; // i128, decimal string
  escrowDeadline: number; // unix seconds (coarse by design)
  method: number;
  methodName: MethodName;
  rail: number; // 0 = Transparent
  laneId: number | null;
  carrier: string | null;
  payout: string | null;
  carrierPkCommit: string | null;
  head: string | null;
  acceptTs: number;
  flightOk: boolean;
}

export type ShipmentResult =
  | { ok: true; shipment: ShipmentView }
  | { ok: false; reason: "notfound" }
  | { ok: false; reason: "rpc"; detail: string };

/** Unit enums with explicit discriminants decode as u32 — normalize anyway. */
function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") return Number(v) || fallback;
  return fallback;
}

function asDecimal(v: unknown): string {
  if (typeof v === "bigint" || typeof v === "number") return v.toString();
  if (typeof v === "string") return v;
  return "0";
}

function asOptDecimal(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return asDecimal(v);
}

function asOptString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

/**
 * Read one shipment via `status(id)`. Distinguishes "no such shipment"
 * (contract Error #11) from "network unreachable" so pages can render a
 * clean empty state vs. an RPC banner. Never throws.
 */
export async function getShipment(id: number): Promise<ShipmentResult> {
  try {
    const retval = await simulate(REGISTRY_ID, "status", [
      xdr.ScVal.scvU64(xdr.Uint64.fromString(String(id))),
    ]);
    if (!retval) return { ok: false, reason: "notfound" };

    const raw = scValToNative(retval) as Record<string, unknown>;
    const state = asNumber(raw.state);
    const method = asNumber(raw.method, 1);
    const shipment: ShipmentView = {
      id,
      cS: asDecimal(raw.c_s),
      state,
      stateName: STATE_NAMES[state] ?? "OPEN",
      merchant: String(raw.merchant ?? ""),
      token: String(raw.token ?? ""),
      amount: asDecimal(raw.amount),
      milestones: Array.isArray(raw.milestones)
        ? raw.milestones.map((m) => asNumber(m))
        : [],
      paid: asDecimal(raw.paid),
      escrowDeadline: asNumber(raw.escrow_deadline),
      method,
      methodName: METHOD_NAMES[method] ?? "COURIER",
      rail: asNumber(raw.rail),
      laneId: raw.lane_id === null || raw.lane_id === undefined
        ? null
        : asNumber(raw.lane_id),
      carrier: asOptString(raw.carrier),
      payout: asOptString(raw.payout),
      carrierPkCommit: asOptDecimal(raw.carrier_pk_commit),
      head: asOptDecimal(raw.head),
      acceptTs: asNumber(raw.accept_ts),
      flightOk: Boolean(raw.flight_ok),
    };
    return { ok: true, shipment };
  } catch (e) {
    if (e instanceof SimulateError && /#11\b/.test(e.detail)) {
      return { ok: false, reason: "notfound" };
    }
    return {
      ok: false,
      reason: "rpc",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Airspace: corridor(lane_id) ───────────────────────────────────────────────

export interface CorridorView {
  root: string; // decimal string
  validFrom: number;
  validTo: number;
}

/** Read the published corridor root for a lane. Returns null on any failure. */
export async function getCorridor(laneId: number): Promise<CorridorView | null> {
  try {
    const retval = await simulate(AIRSPACE_ID, "corridor", [
      xdr.ScVal.scvU32(laneId),
    ]);
    if (!retval) return null;
    const raw = scValToNative(retval) as Record<string, unknown>;
    return {
      root: asDecimal(raw.root),
      validFrom: asNumber(raw.valid_from),
      validTo: asNumber(raw.valid_to),
    };
  } catch {
    return null;
  }
}

// ── RPC health ────────────────────────────────────────────────────────────────

/** Latest ledger sequence, or null when the RPC is unreachable. */
export async function getLatestLedger(): Promise<number | null> {
  try {
    const json = (await rpc({ method: "getLatestLedger" })) as {
      result?: { sequence?: number };
    };
    return json.result?.sequence ?? null;
  } catch {
    return null;
  }
}

// ── Formatting helpers ────────────────────────────────────────────────────────

/** Format an i128 decimal-string amount for display. XLM when it's the SAC. */
export function formatAmount(amount: string, token: string): string {
  if (token === NATIVE_SAC) {
    const xlm = Number(BigInt(amount)) / 1e7;
    return `${xlm.toLocaleString("en-US", { maximumFractionDigits: 7 })} XLM`;
  }
  return amount;
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-6)}` : id;
}

export function utcDay(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function utcTime(ts: number): string {
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}
