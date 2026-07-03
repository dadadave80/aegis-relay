/**
 * dashboard/lib/server/store.ts — the demo "mailbox": an in-memory Map backed
 * by gitignored JSON files under dashboard/.demo-state/, keyed by shipmentId.
 *
 * Holds everything the stateless server needs to carry a shipment through its
 * lifecycle: the off-chain packet (C_S opening + recipient claim seed), the
 * per-shipment carrier Baby Jubjub key, the recipient's PoD, and the generated
 * Groth16 proofs. Also caches prepared (but unsigned) transactions by buildId
 * for the two-step wallet-signing flow.
 *
 * SECURITY: this file persists secrets (recipient claim seed, carrier BJJ seed)
 * to disk — that dir is gitignored. Secrets are NEVER returned to the client;
 * the routes hand back only sanitized views. There are ZERO Stellar keys here.
 */

import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { Packet } from "./prover-dist/lib/packet.js";
import type { Pod } from "./prover-dist/recipient.js";
import type { SnarkjsProof } from "./prover-dist/lib/bn254.js";
import type { Method, Rail, EscrowRecord } from "../types";

const STATE_DIR = path.join(process.cwd(), ".demo-state");
const SHIPS_DIR = path.join(STATE_DIR, "ships");
const PENDING_DIR = path.join(STATE_DIR, "pending");

function ensureDirs() {
  for (const d of [STATE_DIR, SHIPS_DIR, PENDING_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

// ── Records ──────────────────────────────────────────────────────────────────

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

// ── In-memory maps (source of truth within a process) ────────────────────────

const ships = new Map<string, ShipRecord>();
const pending = new Map<string, PendingBuild>();

// ── Ship persistence ─────────────────────────────────────────────────────────

function shipPath(id: string): string {
  return path.join(SHIPS_DIR, `${id}.json`);
}

export function putShip(rec: ShipRecord): void {
  ensureDirs();
  ships.set(rec.shipmentId, rec);
  fs.writeFileSync(shipPath(rec.shipmentId), JSON.stringify(rec, null, 2) + "\n");
}

export function getShip(id: string | number): ShipRecord | undefined {
  const key = String(id);
  const mem = ships.get(key);
  if (mem) return mem;
  try {
    const p = shipPath(key);
    if (fs.existsSync(p)) {
      const rec = JSON.parse(fs.readFileSync(p, "utf8")) as ShipRecord;
      ships.set(key, rec);
      return rec;
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

export function updateShip(id: string | number, patch: Partial<ShipRecord>): ShipRecord | undefined {
  const rec = getShip(id);
  if (!rec) return undefined;
  const next = { ...rec, ...patch };
  putShip(next);
  return next;
}

/** All known shipment ids (from disk + memory), used by the replay attack. */
export function listShipIds(): string[] {
  ensureDirs();
  const set = new Set<string>(ships.keys());
  try {
    for (const f of fs.readdirSync(SHIPS_DIR)) {
      if (f.endsWith(".json")) set.add(f.replace(/\.json$/, ""));
    }
  } catch {
    /* ignore */
  }
  return [...set];
}

// ── Pending-tx persistence ───────────────────────────────────────────────────

function pendingPath(id: string): string {
  return path.join(PENDING_DIR, `${id}.json`);
}

export function putPending(p: PendingBuild): void {
  ensureDirs();
  pending.set(p.buildId, p);
  fs.writeFileSync(pendingPath(p.buildId), JSON.stringify(p, null, 2) + "\n");
}

export function getPending(buildId: string): PendingBuild | undefined {
  const mem = pending.get(buildId);
  if (mem) return mem;
  try {
    const p = pendingPath(buildId);
    if (fs.existsSync(p)) {
      const rec = JSON.parse(fs.readFileSync(p, "utf8")) as PendingBuild;
      pending.set(buildId, rec);
      return rec;
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

export function delPending(buildId: string): void {
  pending.delete(buildId);
  try {
    const p = pendingPath(buildId);
    if (fs.existsSync(p)) fs.rmSync(p);
  } catch {
    /* ignore */
  }
}
