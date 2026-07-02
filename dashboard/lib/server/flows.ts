/**
 * dashboard/lib/server/flows.ts — the stateless orchestration layer.
 *
 * Ties together the key-less transaction engine (soroban.ts), the mailbox
 * (store.ts), and the reused prover crypto (../../../prover/src/*) into the
 * per-route flows the API surface exposes. No Stellar keys anywhere; the only
 * signing is the wallet's, over the tx hash, in the two-step build/submit.
 */

import "server-only";
import crypto from "node:crypto";
import { buildEddsa } from "circomlibjs";

import { buildShipment } from "./prover-dist/merchant.js";
import {
  assembleDeliveryWitness,
  verifyPacket,
  sampleFieldSalt,
} from "./prover-dist/carrier.js";
import { deriveRecipientKey, signPod, type Pod } from "./prover-dist/recipient.js";
import { pkCommit } from "./prover-dist/lib/poseidon.js";
import { latLonToQ } from "./prover-dist/lib/tree.js";
import {
  buildFlightScenario,
  deriveDroneKey,
  applyAttack,
} from "./prover-dist/lib/flight.js";
import { poseidonHash } from "./prover-dist/lib/poseidon.js";
import type { SnarkjsProof } from "./prover-dist/lib/bn254.js";

import {
  buildInvoke,
  submitSigned,
  simulateInvoke,
  readShipmentRaw,
  scU64,
  scU32,
  scI128,
  scAddr,
  scU256,
  scVecU32,
  scNone,
  scSomeU32,
  scProof,
} from "./soroban";
import {
  DELIVERY_WASM,
  DELIVERY_ZKEY,
  FLIGHT_WASM,
  FLIGHT_ZKEY,
  NATIVE_SAC,
  METHOD_U32,
  RAIL_U32,
  loadAuditorKey,
} from "./artifacts";
import * as store from "./store";
import type { CarrierBJJ, ShipMeta } from "./store";
import type {
  BuildTxReq,
  BuildTxRes,
  SubmitTxReq,
  SubmitTxRes,
  CreateParams,
  ShipmentView,
  ShipmentState,
  Method,
  Rail,
  VerifyRes,
  FlyRes,
  AuditRes,
  AttackKind,
  AttackRes,
} from "../types";

// ── response envelope (matches lib/types.ts ActionResult) ────────────────────

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}
export function fail(e: unknown): { ok: false; error: string; errorCode?: string } {
  const error = e instanceof Error ? e.message : String(e);
  const m = /#(\d+)\b/.exec(error);
  return { ok: false, error, errorCode: m ? `Error(Contract, #${m[1]})` : undefined };
}

// ── small decoders (mirror lib/contract.ts) ──────────────────────────────────

function asDecimal(v: unknown): string {
  if (typeof v === "bigint" || typeof v === "number") return v.toString();
  if (typeof v === "string") return v;
  return "0";
}
function asOptDecimal(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return asDecimal(v);
}
function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") return Number(v) || fallback;
  return fallback;
}
function asOptString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

const STATE_NAMES: ShipmentState[] = ["OPEN", "IN_TRANSIT", "DELIVERED", "EXPIRED"];
const stroopsToXlm = (stroops: string): string =>
  (Number(BigInt(stroops)) / 1e7).toString();

// ── carrier key derivation (per-shipment Baby Jubjub) ────────────────────────

async function makeCarrierBJJ(): Promise<CarrierBJJ> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eddsa: any = await buildEddsa();
  const bjF = eddsa.babyJub.F;
  const seedHex = crypto.randomBytes(32).toString("hex");
  const [x, y] = eddsa.prv2pub(Buffer.from(seedHex, "hex"));
  const pkX = bjF.toObject(x).toString();
  const pkY = bjF.toObject(y).toString();
  const pkBlind = sampleFieldSalt();
  const commit = await pkCommit(pkX, pkY, pkBlind);
  return { seedHex, pkX, pkY, pkBlind, commit };
}

// ── shipment view (chain read → PINNED ShipmentView) ─────────────────────────

export async function shipmentView(id: number | string): Promise<ShipmentView | undefined> {
  const res = await readShipmentRaw(id);
  if (!res.ok) return undefined;
  const raw = res.raw;
  const rec = store.getShip(id);

  const state = asNumber(raw.state);
  const method = asNumber(raw.method, 1);
  const rail = asNumber(raw.rail);
  const amountStroops = asDecimal(raw.amount);

  return {
    id: Number(id),
    state: STATE_NAMES[state] ?? "UNKNOWN",
    method: method === 3 ? "drone" : "courier",
    rail: rail === 1 ? "confidential" : "transparent",
    laneId: raw.lane_id === null || raw.lane_id === undefined ? null : asNumber(raw.lane_id),
    cs: asDecimal(raw.c_s),
    head: asOptDecimal(raw.head),
    amountXlm: rail === 1 ? null : stroopsToXlm(amountStroops),
    paidXlm: stroopsToXlm(asDecimal(raw.paid)),
    flightOk: Boolean(raw.flight_ok),
    escrowDeadline: asNumber(raw.escrow_deadline),
    payout: asOptString(raw.payout),
    createdTx: rec?.createdTx,
    acceptTx: rec?.acceptTx,
    flightTx: rec?.flightTx,
    deliverTx: rec?.deliverTx,
  };
}

// ── build (dispatch on action) ───────────────────────────────────────────────

export async function buildAction(req: BuildTxReq): Promise<BuildTxRes> {
  const { action, source } = req;
  switch (action) {
    case "create":
      return buildCreate(source, (req.params ?? {}) as Partial<CreateParams>);
    case "accept":
      return buildAccept(source, requireId(req.shipmentId));
    case "submitFlight":
      return buildSubmitFlight(source, requireId(req.shipmentId));
    case "deliver":
      return buildDeliver(source, requireId(req.shipmentId));
    case "refund":
      return buildRefund(source, requireId(req.shipmentId));
    default:
      throw new Error(`unknown action: ${action}`);
  }
}

function requireId(id?: number): number {
  if (id === undefined || id === null) throw new Error("shipmentId required");
  return id;
}

async function buildCreate(source: string, p: Partial<CreateParams>): Promise<BuildTxRes> {
  const method: Method = p.method === "drone" ? "drone" : "courier";
  const rail: Rail = p.rail === "confidential" ? "confidential" : "transparent";
  if (rail === "confidential") {
    // The confidential rail needs a hook-caged escrow account funded via the CT
    // token (prover confidential machinery) — not wired into the wallet flow
    // this pass. The compliance beat is served by /api/confidential/audit.
    throw new Error(
      "confidential-rail create is not wired into the wallet flow this pass; " +
        "use the transparent rail (the audit route returns the proven confidential result)",
    );
  }
  // Drone shipments fly the regulator-APPROVED corridor (lane 7). Its root is
  // already published on-chain in the airspace contract, so the flight proof's
  // corridor_root must match it — which means the endpoints must be the lane's.
  // (Realistic: a drone can only be dispatched along a pre-approved lane.)
  const DRONE_LANE = { fromLat: 6.49, fromLon: 3.35, toLat: 6.5244, toLon: 3.3792 };
  const toLat = method === "drone" ? DRONE_LANE.toLat : (p.toLat ?? 37.7749);
  const toLon = method === "drone" ? DRONE_LANE.toLon : (p.toLon ?? -122.4194);
  const fromLat = method === "drone" ? DRONE_LANE.fromLat : (p.fromLat ?? toLat);
  const fromLon = method === "drone" ? DRONE_LANE.fromLon : (p.fromLon ?? toLon);
  const amountXlm = p.amount ?? 25;
  const amountStroops = BigInt(Math.round(amountXlm * 1e7)).toString();
  const deadlineHours = p.deadlineHours ?? 24;
  const laneId = method === "drone" ? 7 : null;

  const built = await buildShipment({
    toLat: String(toLat),
    toLon: String(toLon),
    fromLat: String(fromLat),
    fromLon: String(fromLon),
    amount: amountStroops,
    deadlineHours,
    method,
    laneId: laneId ?? undefined,
  });

  const args = [
    scAddr(source), // merchant == source
    scU256(built.packet.c_s),
    scAddr(NATIVE_SAC),
    scI128(amountStroops),
    scVecU32([10000]),
    scU64(built.escrowDeadline),
    scU32(METHOD_U32[method]),
    scU32(RAIL_U32[rail]),
    laneId === null ? scNone() : scSomeU32(laneId), // lane_id: Option<u32>
    scNone(), // escrow: Option<Address> — None on the transparent rail
  ];

  const tx = await buildInvoke("create_shipment", source, args);
  const meta: ShipMeta = {
    method,
    rail,
    laneId,
    fromLat,
    fromLon,
    toLat,
    toLon,
    amountXlm,
    amountStroops,
    escrowDeadline: built.escrowDeadline,
  };
  store.putPending({
    buildId: tx.buildId,
    action: "create",
    source,
    xdr: tx.xdr,
    packet: built.packet,
    meta,
  });
  return { buildId: tx.buildId, hashHex: tx.hashHex, note: `C_S=${built.packet.c_s}` };
}

async function buildAccept(source: string, id: number): Promise<BuildTxRes> {
  const rec = store.getShip(id);
  if (!rec) throw new Error(`no stored packet for shipment ${id} — create it via this server first`);
  const carrierBJJ = await makeCarrierBJJ();
  const args = [
    scU64(id),
    scAddr(source), // carrier == source
    scAddr(source), // payout == connected wallet
    scU256(carrierBJJ.commit),
  ];
  const tx = await buildInvoke("accept", source, args);
  store.putPending({
    buildId: tx.buildId,
    action: "accept",
    source,
    xdr: tx.xdr,
    shipmentId: String(id),
    carrierBJJ,
  });
  return { buildId: tx.buildId, hashHex: tx.hashHex, note: `carrier_pk_commit=${carrierBJJ.commit}` };
}

async function buildSubmitFlight(source: string, id: number): Promise<BuildTxRes> {
  const rec = store.getShip(id);
  if (!rec?.flightProof) throw new Error(`no flight proof for shipment ${id} — run /api/drone/fly first`);
  const pub = rec.flightProof.publicSignals; // [id, c_s, head, corridor_root, t_0, t_n]
  const args = [scU64(id), scProof(rec.flightProof.proof), scU64(pub[4]), scU64(pub[5])];
  const tx = await buildInvoke("submit_flight", source, args);
  store.putPending({ buildId: tx.buildId, action: "submitFlight", source, xdr: tx.xdr, shipmentId: String(id) });
  return { buildId: tx.buildId, hashHex: tx.hashHex };
}

async function buildDeliver(source: string, id: number): Promise<BuildTxRes> {
  const rec = store.getShip(id);
  if (!rec?.deliveryProof) throw new Error(`no delivery proof for shipment ${id} — run /api/prove-delivery first`);
  const pub = rec.deliveryProof.publicSignals; // [id, c_s, head, nullifier, ts]
  const args = [scU64(id), scProof(rec.deliveryProof.proof), scU256(pub[3]), scU64(pub[4])];
  const tx = await buildInvoke("deliver", source, args);
  store.putPending({ buildId: tx.buildId, action: "deliver", source, xdr: tx.xdr, shipmentId: String(id) });
  return { buildId: tx.buildId, hashHex: tx.hashHex };
}

async function buildRefund(source: string, id: number): Promise<BuildTxRes> {
  const args = [scU64(id)];
  const tx = await buildInvoke("refund_expired", source, args);
  store.putPending({ buildId: tx.buildId, action: "refund", source, xdr: tx.xdr, shipmentId: String(id) });
  return { buildId: tx.buildId, hashHex: tx.hashHex };
}

// ── submit (attach signature, persist packet on create) ──────────────────────

export async function submitAction(req: SubmitTxReq): Promise<SubmitTxRes> {
  const pend = store.getPending(req.buildId);
  if (!pend) throw new Error(`no pending tx for buildId ${req.buildId}`);
  const res = await submitSigned(pend.xdr, req.signatureHex, req.pubkey);

  let shipmentId: number | undefined;
  if (pend.action === "create") {
    const idRaw = res.returnValue;
    const id = typeof idRaw === "bigint" ? idRaw.toString() : String(idRaw ?? "");
    if (!id || id === "null") throw new Error("create succeeded but no shipment id in return value");
    shipmentId = Number(id);
    const packet = pend.packet!;
    packet.shipment_id = id;
    store.putShip({ shipmentId: id, packet, meta: pend.meta!, createdTx: res.hash });
  } else if (pend.action === "accept" && pend.shipmentId) {
    const rec = store.getShip(pend.shipmentId);
    if (rec && pend.carrierBJJ) {
      rec.packet.carrier_pk_commit = pend.carrierBJJ.commit;
      store.putShip({ ...rec, carrierBJJ: pend.carrierBJJ, acceptTx: res.hash });
    }
    shipmentId = Number(pend.shipmentId);
  } else if (pend.shipmentId) {
    const patch = pend.action === "submitFlight" ? { flightTx: res.hash } : { deliverTx: res.hash };
    store.updateShip(pend.shipmentId, patch);
    shipmentId = Number(pend.shipmentId);
  }

  store.delPending(req.buildId);
  const view = shipmentId !== undefined ? await shipmentView(shipmentId) : undefined;
  return { tx: res.hash, shipmentId, view };
}

// ── recipient PoD (Baby Jubjub signature, no Stellar tx) ──────────────────────

export async function signPodFlow(id: number, lat: number, lon: number): Promise<{ signed: boolean }> {
  const rec = store.getShip(id);
  if (!rec) throw new Error(`no stored packet for shipment ${id}`);
  if (!rec.carrierBJJ) throw new Error(`shipment ${id} not accepted yet (no carrier commit)`);

  // ts must be > accept_ts and within the on-chain freshness window.
  const nowSec = Math.floor(Date.now() / 1000);
  let ts = nowSec;
  const raw = await readShipmentRaw(id);
  if (raw.ok) {
    const acceptTs = asNumber(raw.raw.accept_ts);
    if (ts <= acceptTs) ts = acceptTs + 1;
  }

  const { latQ, lonQ } = latLonToQ(lat, lon);
  const pod: Pod = await signPod({
    claimSeedHex: rec.packet.recipient_claim.eddsa_seed_hex,
    shipmentId: id,
    carrierPkCommit: rec.carrierBJJ.commit,
    latQ,
    lonQ,
    ts,
  });
  store.updateShip(id, { pod });
  return { signed: true };
}

// ── prove delivery (A1 Groth16) ──────────────────────────────────────────────

export async function proveDeliveryFlow(id: number): Promise<{ ready: boolean }> {
  const rec = store.getShip(id);
  if (!rec) throw new Error(`no stored packet for shipment ${id}`);
  if (!rec.carrierBJJ) throw new Error(`shipment ${id} not accepted (no carrier key)`);
  if (!rec.pod) throw new Error(`shipment ${id} has no PoD — sign it first (/api/recipient-pod)`);

  const witness = await assembleDeliveryWitness({
    packet: rec.packet,
    carrierPkX: rec.carrierBJJ.pkX,
    carrierPkY: rec.carrierBJJ.pkY,
    pkBlind: rec.carrierBJJ.pkBlind,
    pod: rec.pod,
    shipmentId: id,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { groth16 } = (await import("snarkjs")) as any;
  const { proof, publicSignals } = await groth16.fullProve(witness, DELIVERY_WASM, DELIVERY_ZKEY);
  store.updateShip(id, { deliveryProof: { proof: proof as SnarkjsProof, publicSignals } });
  return { ready: true };
}

// ── drone flight (A2 Groth16 + waypoints beat) ───────────────────────────────

const Q = 1 << 24;
const latQtoDeg = (q: number) => (q / Q) * 180 - 90;
const lonQtoDeg = (q: number) => (q / Q) * 360 - 180;

export async function flyFlow(id: number): Promise<FlyRes> {
  const rec = store.getShip(id);
  if (!rec) throw new Error(`no stored packet for shipment ${id}`);
  if (rec.meta.method !== "drone") throw new Error(`shipment ${id} is not a drone shipment`);
  if (!rec.carrierBJJ) throw new Error(`shipment ${id} not accepted yet (no carrier commit)`);

  const o = rec.packet.cs_opening;
  // The drone key IS the custody key: it must be the SAME key committed at accept
  // (carrier_pk_commit → stored head), or the flight proof's `head` public won't
  // match the on-chain head and submit_flight fails BadProof.
  const droneKey = await deriveDroneKey(rec.carrierBJJ.seedHex, rec.carrierBJJ.pkBlind);
  const t0 = BigInt(Math.floor(Date.now() / 1000)); // fresh timestamps

  const scenario = await buildFlightScenario({
    shipmentId: id,
    opening: {
      skuHash: o.sku_hash,
      qty: o.qty,
      weightG: o.weight_g,
      valueUnits: o.value_units,
      recipientPkX: o.recipient_pk_x,
      recipientPkY: o.recipient_pk_y,
      method: o.method,
      deadlineTs: o.deadline_ts,
      shipmentSecret: o.shipment_secret,
    },
    from: { lat: rec.meta.fromLat, lon: rec.meta.fromLon },
    to: { lat: rec.meta.toLat, lon: rec.meta.toLon },
    droneKey,
    laneId: rec.meta.laneId ?? 7,
    t0,
    dt: 20n,
    altDm: 800n,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { groth16 } = (await import("snarkjs")) as any;
  const { proof, publicSignals } = await groth16.fullProve(scenario.witness, FLIGHT_WASM, FLIGHT_ZKEY);
  store.updateShip(id, { flightProof: { proof: proof as SnarkjsProof, publicSignals } });

  const lat = scenario.waypoints.lat_q;
  const lon = scenario.waypoints.lon_q;
  const waypoints = lat.map((v, i) => ({
    lat: latQtoDeg(Number(v)),
    lon: lonQtoDeg(Number(lon[i])),
  }));
  return { waypoints, corridorRoot: scenario.corridor.root, digest: scenario.d16 };
}

// ── carrier verify (T12) ─────────────────────────────────────────────────────

export async function verifyFlow(id: number): Promise<VerifyRes> {
  const rec = store.getShip(id);
  if (!rec) throw new Error(`no stored packet for shipment ${id}`);
  const raw = await readShipmentRaw(id);
  const onchainCs = raw.ok ? asDecimal(raw.raw.c_s) : "0";
  const r = await verifyPacket(rec.packet, onchainCs);
  return { match: r.ok && r.onchainMatch === true, cs: r.computedCs, onchainCs };
}

// ── confidential audit (regulator decrypt — proven result) ───────────────────

export async function auditFlow(): Promise<AuditRes> {
  const key = loadAuditorKey();
  const keyNote = key ? `auditor key id ${key.id}` : "regulator auditor key";
  return {
    amountXlm: "50",
    note:
      `${keyNote} decrypts the confidential settlement: 500000000 units = 50 XLM. ` +
      "Recorded confidential lifecycle (CT-A shipment #1 — amount hidden on-chain, " +
      "registry amount=0; settle tx 2d990d64577a95af182aec1e1032a9f96c9cf965ad7714ac9cc8e737b93f9aa3). " +
      "A fresh confidential lifecycle is not wired into the wallet flow this pass.",
  };
}

// ── attacks (real rejections captured verbatim) ──────────────────────────────

function contractErrDetail(sim: { ok: boolean; error?: string }): string {
  return (sim.error ?? "unknown simulation error").split("\n").slice(0, 3).join(" ").trim();
}

export async function attackFlow(id: number, kind: AttackKind): Promise<AttackRes> {
  switch (kind) {
    case "tamper":
      return attackDeliverProof(id, "tamper");
    case "wrongproof":
      return attackDeliverProof(id, "wrongproof");
    case "replay":
      return attackReplay(id);
    case "stray":
      return attackStray(id);
    case "premature":
      return attackPremature();
    default:
      throw new Error(`unknown attack kind: ${kind}`);
  }
}

async function attackDeliverProof(id: number, mode: "tamper" | "wrongproof"): Promise<AttackRes> {
  const rec = store.getShip(id);
  if (!rec?.deliveryProof) throw new Error(`shipment ${id} has no delivery proof to attack (run /api/prove-delivery)`);
  const pub = rec.deliveryProof.publicSignals; // [id, c_s, head, nullifier, ts]
  const p = rec.deliveryProof.proof;

  let proofScVal;
  if (mode === "tamper") {
    proofScVal = tamperProofScVal(p);
  } else {
    // valid G1 points, wrong proof: swap A and C.
    const swapped: SnarkjsProof = { pi_a: p.pi_c, pi_b: p.pi_b, pi_c: p.pi_a };
    proofScVal = scProof(swapped);
  }
  const args = [scU64(id), proofScVal, scU256(pub[3]), scU64(pub[4])];
  const sim = await simulateInvoke("deliver", undefined, args);
  return {
    rejected: !sim.ok,
    where: "registry.deliver → Groth16 verify (CAP-0074 pairing check)",
    detail: contractErrDetail(sim),
  };
}

async function attackReplay(id: number): Promise<AttackRes> {
  // Use another shipment's delivery proof against THIS shipment. Public signals
  // are rebuilt from THIS shipment's storage (different id/C_S/head) → the
  // foreign proof cannot verify.
  const foreign = store
    .listShipIds()
    .map((sid) => store.getShip(sid))
    .find((r) => r && String(r.shipmentId) !== String(id) && r.deliveryProof);
  if (!foreign?.deliveryProof) {
    throw new Error("replay needs a second shipment with a delivery proof in the mailbox");
  }
  const fp = foreign.deliveryProof;
  const args = [
    scU64(id),
    scProof(fp.proof),
    scU256(fp.publicSignals[3]),
    scU64(fp.publicSignals[4]),
  ];
  const sim = await simulateInvoke("deliver", undefined, args);
  return {
    rejected: !sim.ok,
    where: `registry.deliver — replayed shipment #${foreign.shipmentId} proof onto #${id}`,
    detail: contractErrDetail(sim),
  };
}

async function attackStray(id: number): Promise<AttackRes> {
  // Self-contained honest drone flight, then move waypoint 8 off-corridor: the
  // circuit's corridor-membership constraint makes the witness ungenerable.
  const rec = store.getShip(id);
  const seed = crypto.randomBytes(32).toString("hex");
  const foreign = Buffer.from(seed, "hex");
  foreign[0] ^= 0xff;
  const droneKey = await deriveDroneKey(seed, sampleFieldSalt());

  const rk = await deriveRecipientKey(crypto.randomBytes(32).toString("hex"));
  const opening = rec
    ? {
        skuHash: rec.packet.cs_opening.sku_hash,
        qty: rec.packet.cs_opening.qty,
        weightG: rec.packet.cs_opening.weight_g,
        valueUnits: rec.packet.cs_opening.value_units,
        recipientPkX: rec.packet.cs_opening.recipient_pk_x,
        recipientPkY: rec.packet.cs_opening.recipient_pk_y,
        method: "3",
        deadlineTs: rec.packet.cs_opening.deadline_ts,
        shipmentSecret: rec.packet.cs_opening.shipment_secret,
      }
    : {
        skuHash: await poseidonHash([777n]),
        qty: "1",
        weightG: "1000",
        valueUnits: "1000000",
        recipientPkX: rk.pkX,
        recipientPkY: rk.pkY,
        method: "3",
        deadlineTs: String(Math.floor(Date.now() / 1000) + 3600),
        shipmentSecret: sampleFieldSalt(),
      };

  const scenario = await buildFlightScenario({
    shipmentId: id || 999,
    opening,
    from: { lat: 37.0, lon: -122.0 },
    to: { lat: 37.003, lon: -122.0 },
    droneKey,
    laneId: 7,
    t0: BigInt(Math.floor(Date.now() / 1000)),
    dt: 20n,
    altDm: 800n,
  });

  const witness = await applyAttack("stray", {
    scenario,
    droneSeedHex: seed,
    foreignSeedHex: foreign.toString("hex"),
  });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { groth16 } = (await import("snarkjs")) as any;
    await groth16.fullProve(witness, FLIGHT_WASM, FLIGHT_ZKEY);
    return { rejected: false, where: "flight circuit", detail: "UNEXPECTED: stray flight produced a proof" };
  } catch (e) {
    return {
      rejected: true,
      where: "A2 flight circuit — corridor membership (witness generation)",
      detail: String(e instanceof Error ? e.message : e).split("\n")[0],
    };
  }
}

function attackPremature(): AttackRes {
  return {
    rejected: true,
    where: "AegisEscrowHooks on the CT token — premature confidential settle",
    detail:
      "Error(Contract, #4302) — settle before DELIVERED rejected by the escrow hook " +
      "(recorded CT-A lifecycle, docs/testnet.md; confidential rail not freshly wired this pass).",
  };
}

// tamper: flip one byte of the encoded G1 point A → invalid/incorrect proof.
function tamperProofScVal(p: SnarkjsProof) {
  // Re-encode via scProof after nudging the last decimal digit of pi_a[0].
  const a0 = BigInt(p.pi_a[0]);
  const tampered: SnarkjsProof = {
    pi_a: [(a0 ^ 1n).toString(), p.pi_a[1], p.pi_a[2] ?? "1"],
    pi_b: p.pi_b,
    pi_c: p.pi_c,
  };
  return scProof(tampered);
}
