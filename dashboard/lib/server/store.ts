/**
 * dashboard/lib/server/store.ts — the demo "mailbox", re-backed on the KV
 * adapter (lib/server/kv.ts). Every accessor delegates to `kv`; the in-memory
 * Map fallback (dev / no KV env) lives in kv.ts, so this module holds NO local
 * state and NO fs. All accessors are async.
 *
 * Carries a shipment through its lifecycle (off-chain packet, per-shipment
 * carrier Baby Jubjub key, recipient PoD, Groth16 proofs, confidential escrow
 * packet) plus the prepared-but-unsigned tx cache, and the marketplace indices
 * (open listings, claim contexts, carrier credential status, reputation).
 *
 * SECURITY: values here include secrets (recipient claim seed, carrier BJJ seed,
 * E's Stellar secret). KV is a private backing store; secrets are NEVER returned
 * to the client — the routes hand back only sanitized views. ZERO Stellar keys
 * are minted here.
 */

import "server-only";
import { kv } from "./kv";
import type { Packet } from "./prover-dist/lib/packet.js";
import type { Pod } from "./prover-dist/recipient.js";
import type { SnarkjsProof } from "./prover-dist/lib/bn254.js";
import type {
  Method,
  Rail,
  EscrowRecord,
  Listing,
  ClaimContext,
  CarrierStatus,
  Reputation,
} from "../types";

// ── Records (shapes unchanged; flows.ts imports CarrierBJJ + ShipMeta) ────────

/** Per-shipment carrier signing key. `seedHex` is secret — never leaves here. */
export interface CarrierBJJ {
  seedHex: string;
  pkX: string;
  pkY: string;
  pkBlind: string;
  commit: string; // carrier_pk_commit (decimal)
}

export interface ProofBundle {
  proof: SnarkjsProof;
  publicSignals: string[];
}

export interface ShipMeta {
  method: Method;
  rail: Rail;
  laneId: number | null;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  amountXlm: number;
  amountStroops: string;
  escrowDeadline: string;
}

export interface ShipRecord {
  shipmentId: string;
  packet: Packet;
  meta: ShipMeta;
  carrierBJJ?: CarrierBJJ;
  pod?: Pod;
  deliveryProof?: ProofBundle;
  flightProof?: ProofBundle;
  /** Confidential rail: E's packet (secret + Grumpkin + opening). Never returned
   * to clients except to the settling wallet (E's key is a hook-caged capability). */
  escrow?: EscrowRecord;
  createdTx?: string;
  acceptTx?: string;
  flightTx?: string;
  deliverTx?: string;
  settleTx?: string;
}

/** A prepared-but-unsigned transaction awaiting the wallet's signature. */
export interface PendingBuild {
  buildId: string;
  action: string;
  source: string;
  xdr: string;
  shipmentId?: string; // for accept/submitFlight/deliver/refund
  // create-only payload, promoted to a ShipRecord once the id is assigned:
  packet?: Packet;
  meta?: ShipMeta;
  escrow?: EscrowRecord; // confidential create only
  // accept-only payload, attached to the ShipRecord on submit:
  carrierBJJ?: CarrierBJJ;
}

// ── key helpers ───────────────────────────────────────────────────────────────

const SHIP = (id: string | number) => `ship:${id}`;
const SHIP_IDS = "ship:ids";
const PENDING = (buildId: string) => `pending:${buildId}`;
const LISTING = (id: string | number) => `listing:${id}`;
const OPEN_SET = "listings:open"; // authoritative membership (removable via srem)
const OPEN_Z = "listings:open:z"; // append-only created-order index (zadd; no zrem)
const CLAIM = (token: string) => `claim:${token}`;
const CARRIER = (address: string) => `carrier:${address}`;
const REP = (address: string) => `rep:${address}`;

// ── Ships ──────────────────────────────────────────────────────────────────────

export async function putShip(rec: ShipRecord): Promise<void> {
  await kv.set(SHIP(rec.shipmentId), rec);
  await kv.sadd(SHIP_IDS, String(rec.shipmentId));
}

export async function getShip(id: string | number): Promise<ShipRecord | undefined> {
  return (await kv.get<ShipRecord>(SHIP(id))) ?? undefined;
}

export async function updateShip(
  id: string | number,
  patch: Partial<ShipRecord>,
): Promise<ShipRecord | undefined> {
  const rec = await getShip(id);
  if (!rec) return undefined;
  const next = { ...rec, ...patch };
  await putShip(next);
  return next;
}

/** All known shipment ids, used by the replay attack + marketplace sweeps. */
export async function listShipIds(): Promise<string[]> {
  return kv.smembers(SHIP_IDS);
}

// ── Pending txs ─────────────────────────────────────────────────────────────────

export async function putPending(p: PendingBuild): Promise<void> {
  await kv.set(PENDING(p.buildId), p);
}

export async function getPending(buildId: string): Promise<PendingBuild | undefined> {
  return (await kv.get<PendingBuild>(PENDING(buildId))) ?? undefined;
}

export async function delPending(buildId: string): Promise<void> {
  await kv.del(PENDING(buildId));
}

// ── Listings + open index ───────────────────────────────────────────────────────

export async function putListing(l: Listing): Promise<void> {
  await kv.set(LISTING(l.shipmentId), l);
}

export async function getListing(id: string | number): Promise<Listing | undefined> {
  return (await kv.get<Listing>(LISTING(id))) ?? undefined;
}

/** Track a shipment as an open listing. The set is authoritative membership
 *  (removable via srem); the sorted set carries created-order for the feed. */
export async function addOpenListing(id: string | number, createdAt: number): Promise<void> {
  await kv.sadd(OPEN_SET, String(id));
  await kv.zadd(OPEN_Z, createdAt, String(id));
}

export async function removeOpenListing(id: string | number): Promise<void> {
  await kv.srem(OPEN_SET, String(id));
}

/** Open listing ids in createdAt order. The z-index is append-only (no zrem),
 *  so we intersect its order with the authoritative membership set; any live id
 *  missing from the z-index is appended defensively. */
export async function listOpenListings(): Promise<string[]> {
  const [ordered, live] = await Promise.all([
    kv.zrange(OPEN_Z, 0, -1),
    kv.smembers(OPEN_SET),
  ]);
  const liveSet = new Set(live);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ordered) {
    if (liveSet.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of live) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

// ── Claim contexts (seed stays in the URL fragment; never here) ──────────────────

export async function putClaimContext(token: string, ctx: ClaimContext): Promise<void> {
  await kv.set(CLAIM(token), ctx);
}

export async function getClaimContext(token: string): Promise<ClaimContext | undefined> {
  return (await kv.get<ClaimContext>(CLAIM(token))) ?? undefined;
}

// ── Carrier credential status ────────────────────────────────────────────────────

export async function getCarrier(address: string): Promise<CarrierStatus> {
  return (await kv.get<CarrierStatus>(CARRIER(address))) ?? { credentialed: false };
}

export async function setCarrierCredentialed(address: string, at: number): Promise<void> {
  const status: CarrierStatus = { credentialed: true, onboardedAt: at };
  await kv.set(CARRIER(address), status);
}

// ── Reputation ───────────────────────────────────────────────────────────────────

export async function getRep(address: string): Promise<Reputation> {
  return (await kv.get<Reputation>(REP(address))) ?? { delivered: 0, expired: 0 };
}

export async function bumpRep(
  address: string,
  kind: "delivered" | "expired",
): Promise<Reputation> {
  const rep = await getRep(address);
  const next: Reputation = {
    delivered: rep.delivered + (kind === "delivered" ? 1 : 0),
    expired: rep.expired + (kind === "expired" ? 1 : 0),
  };
  await kv.set(REP(address), next);
  return next;
}
