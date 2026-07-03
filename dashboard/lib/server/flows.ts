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
import type { Pod } from "./prover-dist/recipient.js";
import { pkCommit } from "./prover-dist/lib/poseidon.js";
import { latLonToQ, mortonCell } from "./prover-dist/lib/tree.js";
import { RD_RES } from "./prover-dist/lib/constants.js";
import { podRecord, type PodEnvelope } from "../pod/pod-record";
import {
  buildFlightScenario,
  deriveDroneKey,
} from "./prover-dist/lib/flight.js";
import type { SnarkjsProof } from "./prover-dist/lib/bn254.js";

import {
  buildInvoke,
  submitSignedXdr,
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
  NATIVE_SAC,
  CT_TOKEN_ID,
  METHOD_U32,
  RAIL_U32,
} from "./artifacts";
import { auditLastTransfer } from "./confidential-audit";
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
  ConfSettleRelease,
  ClaimContext,
  PodSignReq,
  Listing,
  MarketClaimResult,
  CarrierStatus,
  Reputation,
} from "../types";
import { isValidStellarAddress } from "../carrier-gate";
import { buildListing } from "../listing";
import { decideClaim } from "../market/claim-gate";

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
  const rec = await store.getShip(id);

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
  if (rail === "confidential") return buildConfidentialCreate(source, p);
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
  await store.putPending({
    buildId: tx.buildId,
    action: "create",
    source,
    xdr: tx.xdr,
    packet: built.packet,
    meta,
  });
  return { buildId: tx.buildId, xdr: tx.xdr, note: `C_S=${built.packet.c_s}` };
}

/**
 * Confidential-rail create (ports prover/src/confidential.ts cmdCreateShipment).
 * The registry NEVER learns the amount: amount=0, single milestone [10000], token
 * = the hooked CT token, escrow = Some(E). The browser funds E FIRST
 * (ConfidentialMerchant.fundEscrow) and passes E's address + packet here; the
 * packet is stashed in the pending build and promoted to the ShipRecord on submit.
 * Courier only — the confidential rail carries no drone corridor.
 */
async function buildConfidentialCreate(source: string, p: Partial<CreateParams>): Promise<BuildTxRes> {
  const escrow = p.escrow;
  if (!escrow) {
    throw new Error(
      "confidential create requires a funded escrow account E — fund it in the browser first " +
        "(ConfidentialMerchant.fundEscrow), then submit with its address",
    );
  }
  const toLat = p.toLat ?? 37.7749;
  const toLon = p.toLon ?? -122.4194;
  const deadlineHours = p.deadlineHours ?? 24;

  const built = await buildShipment({
    toLat: String(toLat),
    toLon: String(toLon),
    amount: "0", // the registry never learns the confidential amount
    deadlineHours,
    method: "courier",
  });

  const args = [
    scAddr(source), // merchant == source
    scU256(built.packet.c_s),
    scAddr(CT_TOKEN_ID), // the HOOKED CT token (T25 pin), not NATIVE_SAC
    scI128("0"), // amount 0 on the registry
    scVecU32([10000]), // single milestone
    scU64(built.escrowDeadline),
    scU32(METHOD_U32.courier),
    scU32(RAIL_U32.confidential),
    scNone(), // lane_id: None
    scAddr(escrow), // escrow: Some(E)
  ];
  const tx = await buildInvoke("create_shipment", source, args);
  const meta: ShipMeta = {
    method: "courier",
    rail: "confidential",
    laneId: null,
    fromLat: toLat,
    fromLon: toLon,
    toLat,
    toLon,
    // The merchant's private reference (mailbox-only, never on-chain). The view
    // layer renders "hidden" for the confidential rail.
    amountXlm: p.amount ?? 0,
    amountStroops: "0", // registry amount is 0
    escrowDeadline: built.escrowDeadline,
  };
  await store.putPending({
    buildId: tx.buildId,
    action: "create",
    source,
    xdr: tx.xdr,
    packet: built.packet,
    meta,
    escrow: p.escrowRecord,
  });
  return {
    buildId: tx.buildId,
    xdr: tx.xdr,
    note: `confidential C_S=${built.packet.c_s}, escrow ${escrow.slice(0, 8)}…, amount hidden on-chain`,
  };
}

async function buildAccept(source: string, id: number): Promise<BuildTxRes> {
  const rec = await store.getShip(id);
  if (!rec) throw new Error(`no stored packet for shipment ${id} — create it via this server first`);
  const carrierBJJ = await makeCarrierBJJ();
  const args = [
    scU64(id),
    scAddr(source), // carrier == source
    scAddr(source), // payout == connected wallet
    scU256(carrierBJJ.commit),
  ];
  const tx = await buildInvoke("accept", source, args);
  await store.putPending({
    buildId: tx.buildId,
    action: "accept",
    source,
    xdr: tx.xdr,
    shipmentId: String(id),
    carrierBJJ,
  });
  return { buildId: tx.buildId, xdr: tx.xdr, note: `carrier_pk_commit=${carrierBJJ.commit}` };
}

async function buildSubmitFlight(source: string, id: number): Promise<BuildTxRes> {
  const rec = await store.getShip(id);
  if (!rec?.flightProof) throw new Error(`no flight proof for shipment ${id} — run /api/drone/fly first`);
  const pub = rec.flightProof.publicSignals; // [id, c_s, head, corridor_root, t_0, t_n]
  const args = [scU64(id), scProof(rec.flightProof.proof), scU64(pub[4]), scU64(pub[5])];
  const tx = await buildInvoke("submit_flight", source, args);
  await store.putPending({ buildId: tx.buildId, action: "submitFlight", source, xdr: tx.xdr, shipmentId: String(id) });
  return { buildId: tx.buildId, xdr: tx.xdr };
}

async function buildDeliver(source: string, id: number): Promise<BuildTxRes> {
  const rec = await store.getShip(id);
  if (!rec?.deliveryProof) throw new Error(`no delivery proof for shipment ${id} — run /api/prove-delivery first`);
  const pub = rec.deliveryProof.publicSignals; // [id, c_s, head, nullifier, ts]
  const args = [scU64(id), scProof(rec.deliveryProof.proof), scU256(pub[3]), scU64(pub[4])];
  const tx = await buildInvoke("deliver", source, args);
  await store.putPending({ buildId: tx.buildId, action: "deliver", source, xdr: tx.xdr, shipmentId: String(id) });
  return { buildId: tx.buildId, xdr: tx.xdr };
}

async function buildRefund(source: string, id: number): Promise<BuildTxRes> {
  const args = [scU64(id)];
  const tx = await buildInvoke("refund_expired", source, args);
  await store.putPending({ buildId: tx.buildId, action: "refund", source, xdr: tx.xdr, shipmentId: String(id) });
  return { buildId: tx.buildId, xdr: tx.xdr };
}

// ── submit (attach signature, persist packet on create) ──────────────────────

export async function submitAction(req: SubmitTxReq): Promise<SubmitTxRes> {
  const pend = await store.getPending(req.buildId);
  if (!pend) throw new Error(`no pending tx for buildId ${req.buildId}`);
  const res = await submitSignedXdr(req.signedXdr, pend.xdr);

  let shipmentId: number | undefined;
  let claimLink: string | undefined;
  if (pend.action === "create") {
    const idRaw = res.returnValue;
    const id = typeof idRaw === "bigint" ? idRaw.toString() : String(idRaw ?? "");
    if (!id || id === "null") throw new Error("create succeeded but no shipment id in return value");
    shipmentId = Number(id);
    const packet = pend.packet!;
    const meta = pend.meta!;
    packet.shipment_id = id;

    // The server never holds the recipient's claim seed once the shipment
    // exists (Task 3 review: "server never holds the seed"). Capture it ONLY
    // to mint the claim link below, then persist a stripped copy of the
    // packet — assembleDeliveryWitness/verifyPacket read cs_opening/
    // dest_region/pod, never recipient_claim, so the delivery path is
    // unaffected by the strip.
    const claimSeedHex = packet.recipient_claim.eddsa_seed_hex;
    const persistedPacket = { ...packet, recipient_claim: { eddsa_seed_hex: "" } };
    await store.putShip({ shipmentId: id, packet: persistedPacket, meta, createdTx: res.hash, escrow: pend.escrow });

    // ── Marketplace: publish the OPEN board listing (spec §6.1) ──
    const createdAt = Date.now();
    const listing = buildListing({
      shipmentId,
      rail: meta.rail,
      method: meta.method,
      laneId: meta.laneId,
      amountXlm: meta.amountXlm, // null'd for the confidential rail inside buildListing
      escrowDeadline: Number(meta.escrowDeadline),
      createdAt,
    });
    await store.putListing(listing);
    await store.addOpenListing(id, createdAt);

    // Recipient signing context — deliberately WITHOUT the claim seed. Only the
    // dest-region root is exposed (minimal disclosure, §13; the recipient derives
    // cell_rd from their own confirmed location). carrier_pk_commit is bound at accept.
    const ctx: ClaimContext = {
      shipmentId,
      carrierPkCommit: "",
      destRegion: packet.dest_region.root,
      tsWindow: Number(meta.escrowDeadline),
    };
    await store.putClaimContext(id, ctx);

    // The claim SEED travels ONLY in the link fragment — never sent to or stored by
    // the server (§5 honesty). Surfaced here so the merchant UI can hand the link
    // to the recipient. The id exists only now (create_shipment return value).
    claimLink = `/claim/${id}#${claimSeedHex}`;
  } else if (pend.action === "accept" && pend.shipmentId) {
    const rec = await store.getShip(pend.shipmentId);
    if (rec && pend.carrierBJJ) {
      rec.packet.carrier_pk_commit = pend.carrierBJJ.commit;
      await store.putShip({ ...rec, carrierBJJ: pend.carrierBJJ, acceptTx: res.hash });
    }
    shipmentId = Number(pend.shipmentId);

    // ── Marketplace: the shipment leaves the board; listing → IN_TRANSIT + payout ──
    await store.removeOpenListing(pend.shipmentId);
    const listing = await store.getListing(pend.shipmentId);
    if (listing) {
      listing.state = "IN_TRANSIT";
      listing.payout = pend.source; // payout == the connected carrier wallet (buildAccept)
      await store.putListing(listing);
    }
    // Complete the recipient signing context now that a carrier is bound: the
    // create-time stub only has the dest-region ROOT (no carrier yet); fill in
    // carrierPkCommit AND reshape destRegion into { lat, lon, cellRd } — the
    // exact fields claimContextFlow/the /claim page/signPodBrowser need. (rec
    // is the just-fetched-above ShipRecord; reused, no extra store round-trip.)
    if (pend.carrierBJJ) {
      const ctx = await store.getClaimContext(pend.shipmentId);
      if (ctx) {
        ctx.carrierPkCommit = pend.carrierBJJ.commit;
        if (rec) {
          const { latQ, lonQ } = latLonToQ(rec.meta.toLat, rec.meta.toLon);
          ctx.destRegion = {
            lat: rec.meta.toLat,
            lon: rec.meta.toLon,
            cellRd: mortonCell(latQ, lonQ, RD_RES).toString(),
          };
        }
        await store.putClaimContext(pend.shipmentId, ctx);
      }
    }
  } else if (pend.shipmentId) {
    const patch = pend.action === "submitFlight" ? { flightTx: res.hash } : { deliverTx: res.hash };
    await store.updateShip(pend.shipmentId, patch);
    shipmentId = Number(pend.shipmentId);
  }

  await store.delPending(req.buildId);
  const view = shipmentId !== undefined ? await shipmentView(shipmentId) : undefined;
  return { tx: res.hash, shipmentId, view, claimLink };
}

// ── recipient claim link (GET context + in-browser PoD store) ────────────────

/**
 * True once a KV-stored ClaimContext has been completed at accept-time:
 * carrierPkCommit bound + destRegion reshaped to { lat, lon, cellRd } (see
 * submitAction's accept branch). The create-time stub has an empty commit and
 * a bare dest-region ROOT string — never signable — so it must NOT be served
 * as-is; falling through to the mailbox-packet derivation below both gates
 * gracefully ("no carrier yet") and self-heals if the accept-time patch above
 * were ever missed.
 */
function isCompleteClaimContext(ctx: ClaimContext): boolean {
  return (
    Boolean(ctx.carrierPkCommit) &&
    typeof ctx.destRegion === "object" &&
    ctx.destRegion !== null &&
    "cellRd" in (ctx.destRegion as Record<string, unknown>)
  );
}

/**
 * Signing context for the recipient claim page (/claim/<id>). Returns ONLY what
 * the browser needs to sign the PoD — the carrier commit, the committed dest
 * region cell (cell_rd) + its coords for the location confirm, and the ts to
 * sign at. NEVER the claim seed (that rides the URL fragment, client-only). A
 * COMPLETE create-time context in KV wins; otherwise it is derived fresh from
 * the mailbox packet (also the graceful "no carrier yet" path pre-accept).
 */
export async function claimContextFlow(id: number): Promise<ClaimContext> {
  if (!Number.isInteger(id) || id < 1) throw new Error(`not a shipment id: ${id}`);

  // tsWindow is time-relative — it can NEVER be treated as "complete" and
  // stored/reused verbatim. The registry enforces |now - ts| <= WINDOW_SEC
  // (600s); a stale ts (e.g. the create-time `escrowDeadline` placeholder,
  // hours-to-a-day out) makes `deliver` revert with Error::StaleTs. So this is
  // recomputed FRESH on every return path, stored-complete or derived. ts must
  // also land strictly after accept_ts (on-chain freshness).
  const freshTsWindow = async (): Promise<number> => {
    let ts = Math.floor(Date.now() / 1000);
    const raw = await readShipmentRaw(id);
    if (raw.ok) {
      const acceptTs = asNumber(raw.raw.accept_ts);
      if (ts <= acceptTs) ts = acceptTs + 1;
    }
    return ts;
  };

  const stored = await store.getClaimContext(String(id));
  if (stored && isCompleteClaimContext(stored)) {
    return { ...stored, tsWindow: await freshTsWindow() };
  }

  const rec = await store.getShip(id);
  if (!rec) throw new Error(`no shipment #${id} on this server — the claim link is for an unknown shipment`);
  if (!rec.carrierBJJ) {
    throw new Error(`shipment #${id} has no carrier yet — there is nothing to sign until a carrier accepts custody`);
  }

  const { latQ, lonQ } = latLonToQ(rec.meta.toLat, rec.meta.toLon);
  const cellRd = mortonCell(latQ, lonQ, RD_RES).toString();

  return {
    shipmentId: id,
    carrierPkCommit: rec.carrierBJJ.commit,
    destRegion: { lat: rec.meta.toLat, lon: rec.meta.toLon, cellRd },
    tsWindow: await freshTsWindow(),
  };
}

/**
 * Store a browser-signed proof-of-delivery against ship:<id>. The recipient
 * derived their Baby Jubjub key from the fragment seed and signed
 * m = Poseidon(DOM_PODMSG, id, carrier_pk_commit, cell_rd, ts) IN THE BROWSER;
 * only the signature (+ ts + the confirmed committed coords) reaches us. We
 * persist it in the exact Pod shape the A1 delivery witness reads. The coords are
 * the committed dest coords, so cell_rd recomputed from lat_q/lon_q matches the
 * signed message.
 */
export async function recordPodFlow(req: PodSignReq): Promise<{ signed: boolean }> {
  const { shipmentId, signature, lat, lon } = req;
  const rec = await store.getShip(shipmentId);
  if (!rec) throw new Error(`no stored packet for shipment ${shipmentId}`);
  if (!rec.carrierBJJ) throw new Error(`shipment ${shipmentId} not accepted yet (no carrier commit)`);
  const { latQ, lonQ } = latLonToQ(lat, lon);
  const pod = podRecord(signature as PodEnvelope, latQ, lonQ);
  await store.updateShip(shipmentId, { pod: pod as Pod });
  return { signed: true };
}

// ── prove delivery (A1 Groth16) ──────────────────────────────────────────────

/** Deep-convert BigInt → string so a circuit witness survives JSON transport to
 *  the browser prover (snarkjs accepts string field elements). */
function jsonSafeInput(w: unknown): unknown {
  if (typeof w === "bigint") return w.toString();
  if (Array.isArray(w)) return w.map(jsonSafeInput);
  if (w && typeof w === "object") {
    return Object.fromEntries(
      Object.entries(w as Record<string, unknown>).map(([k, v]) => [k, jsonSafeInput(v)]),
    );
  }
  return w;
}

/**
 * Server assembles the A1 delivery witness and returns it as the circuit INPUT
 * for BROWSER Groth16 proving (snarkjs.groth16.fullProve on the client, against
 * the /circuits static wasm+zkey). The browser stores the resulting proof back
 * via recordDeliveryProofFlow before `deliver`. Proving is off the server so the
 * multi-MB zkeys never need to live in a serverless function.
 */
export async function deliveryInputFlow(id: number): Promise<{ input: unknown }> {
  const rec = await store.getShip(id);
  if (!rec) throw new Error(`no stored packet for shipment ${id}`);
  if (!rec.carrierBJJ) throw new Error(`shipment ${id} not accepted (no carrier key)`);
  if (!rec.pod) throw new Error(`shipment ${id} has no PoD — the recipient must sign the claim link first (/claim/${id})`);

  const witness = await assembleDeliveryWitness({
    packet: rec.packet,
    carrierPkX: rec.carrierBJJ.pkX,
    carrierPkY: rec.carrierBJJ.pkY,
    pkBlind: rec.carrierBJJ.pkBlind,
    pod: rec.pod,
    shipmentId: id,
  });
  return { input: jsonSafeInput(witness) };
}

/** Store a browser-generated delivery proof against the shipment. The tx-build
 *  (`deliver`) reads it unchanged — a browser proof over the same witness is
 *  identical to a server-generated one, so the on-chain verify path is preserved. */
export async function recordDeliveryProofFlow(
  id: number,
  proof: unknown,
  publicSignals: string[],
): Promise<{ ready: boolean }> {
  if (!await store.getShip(id)) throw new Error(`no stored packet for shipment ${id}`);
  if (!proof || !Array.isArray(publicSignals)) throw new Error("proof + publicSignals required");
  await store.updateShip(id, { deliveryProof: { proof: proof as SnarkjsProof, publicSignals } });
  return { ready: true };
}

// ── drone flight (A2 Groth16 + waypoints beat) ───────────────────────────────

const Q = 1 << 24;
const latQtoDeg = (q: number) => (q / Q) * 180 - 90;
const lonQtoDeg = (q: number) => (q / Q) * 360 - 180;

/**
 * Server builds the flight scenario (fresh telemetry over the committed corridor)
 * and returns the waypoints (for the map) + the A2 circuit INPUT for BROWSER
 * Groth16 proving. The browser proves and stores via recordFlightProofFlow before
 * `submit_flight`. The fresh `t0` is baked into the witness → proof → publicSignals,
 * so it flows to the tx consistently.
 */
export async function flightInputFlow(id: number): Promise<FlyRes & { input: unknown }> {
  const rec = await store.getShip(id);
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

  const lat = scenario.waypoints.lat_q;
  const lon = scenario.waypoints.lon_q;
  const waypoints = lat.map((v, i) => ({
    lat: latQtoDeg(Number(v)),
    lon: lonQtoDeg(Number(lon[i])),
  }));
  return {
    waypoints,
    corridorRoot: scenario.corridor.root,
    digest: scenario.d16,
    input: jsonSafeInput(scenario.witness),
  };
}

/** Store a browser-generated flight proof against the shipment (submit_flight
 *  reads it unchanged). */
export async function recordFlightProofFlow(
  id: number,
  proof: unknown,
  publicSignals: string[],
): Promise<{ ok: boolean }> {
  if (!await store.getShip(id)) throw new Error(`no stored packet for shipment ${id}`);
  if (!proof || !Array.isArray(publicSignals)) throw new Error("proof + publicSignals required");
  await store.updateShip(id, { flightProof: { proof: proof as SnarkjsProof, publicSignals } });
  return { ok: true };
}

// ── carrier verify (T12) ─────────────────────────────────────────────────────

export async function verifyFlow(id: number): Promise<VerifyRes> {
  const rec = await store.getShip(id);
  if (!rec) throw new Error(`no stored packet for shipment ${id}`);
  const raw = await readShipmentRaw(id);
  const onchainCs = raw.ok ? asDecimal(raw.raw.c_s) : "0";
  const r = await verifyPacket(rec.packet, onchainCs);
  return { match: r.ok && r.onchainMatch === true, cs: r.computedCs, onchainCs };
}

// ── confidential audit (regulator decrypt — proven result) ───────────────────

export async function auditFlow(txHash?: string): Promise<AuditRes> {
  // Real decrypt: the regulator's Grumpkin secret (server-held) opens the dual
  // auditor ciphertexts of the last confidential settlement on the current token.
  let decrypt: Awaited<ReturnType<typeof auditLastTransfer>> = null;
  let liveError: string | undefined;
  try {
    decrypt = await auditLastTransfer(txHash);
  } catch (e) {
    liveError = e instanceof Error ? e.message : String(e);
  }

  if (decrypt) {
    return {
      amountXlm: decrypt.amountXlm,
      txHash: decrypt.txHash,
      from: decrypt.from,
      to: decrypt.to,
      channelsAgree: decrypt.channelsAgree,
      note:
        `Regulator decrypt (auditor key 0): ${decrypt.amountUnits} units = ${decrypt.amountXlm} XLM ` +
        `(settle tx ${decrypt.txHash.slice(0, 10)}…; sender + recipient channels agree: ${decrypt.channelsAgree}). ` +
        "Private to the world, transparent to the regulator.",
    };
  }

  // Honest fallback — no canned amount. Either the auditor key is absent, no
  // confidential settlement exists on the current token yet, or the live read
  // threw (RPC). Say which.
  const reason = liveError
    ? `live decrypt failed: ${liveError}`
    : "no confidential settlement on the current CT token yet — create + settle a confidential shipment to produce one";
  return { amountXlm: "—", note: `Regulator decrypt unavailable (${reason}).` };
}

// ── confidential settle (release E's packet, gated on DELIVERED) ──────────────

/**
 * Release E's escrow packet to the settling browser for a DELIVERED confidential
 * shipment, with the on-chain payout. The browser then runs settleEscrow(E→payout)
 * signed by E's keypair (the token's AegisEscrowHooks admit it iff Delivered —
 * a premature attempt aborts #4302, so this gate is defence-in-depth, not the
 * only guard).
 *
 * SECURITY: this returns E's Stellar SECRET to the browser — the ONE exception to
 * store.ts's "secrets never returned". Deliberate, per the client-side design
 * ("E's keys travel in the packet"): E is a throwaway per-shipment account whose
 * only funds are the hook-caged escrow. Gated on DELIVERED so the packet only
 * leaves the server once settle is actually admissible.
 */
export async function releaseEscrowFlow(shipmentId: number): Promise<ConfSettleRelease> {
  const rec = await store.getShip(shipmentId);
  if (!rec) throw new Error(`no stored record for shipment ${shipmentId}`);
  if (!rec.escrow) throw new Error(`shipment ${shipmentId} has no confidential escrow (transparent rail?)`);
  const view = await shipmentView(shipmentId);
  if (!view) throw new Error(`shipment ${shipmentId} not found on-chain`);
  if (view.state !== "DELIVERED") {
    throw new Error(`shipment ${shipmentId} is ${view.state}, not DELIVERED — settle is not admissible yet`);
  }
  if (!view.payout) throw new Error(`shipment ${shipmentId} has no on-chain payout address`);
  return { escrow: rec.escrow, payout: view.payout, state: view.state };
}

/** Record the confidential settle tx against the shipment (after the browser submits it). */
export async function recordSettleFlow(shipmentId: number, settleTx: string): Promise<{ recorded: boolean }> {
  const updated = await store.updateShip(shipmentId, { settleTx });
  return { recorded: updated !== undefined };
}

// ── market board (Task 5) ─────────────────────────────────────────────────────

/**
 * GET /api/market — the carrier board. Reads the openListings index and hydrates
 * each row from its listing:<id> summary (only on-chain-public metadata; amount is
 * null on the confidential rail — spec §9). Newest first. The KV index is a fast
 * cache over the registry, which stays the source of truth.
 */
export async function marketListFlow(): Promise<Listing[]> {
  const ids = await store.listOpenListings();
  const rows: Listing[] = [];
  for (const id of ids) {
    const l = await store.getListing(id);
    if (l) rows.push(l);
  }
  rows.sort((a, b) => b.createdAt - a.createdAt);
  return rows;
}

/**
 * POST /api/market — credential-gated claim. A credentialed carrier receives the
 * sealed packet (recipient claim seed stripped) to verify T12 and then accept;
 * a non-credentialed caller gets a structured onboarding CTA (spec §3/§9/§10).
 * `address` is the connected wallet (the caller identity).
 *
 * store.ts is KV-backed and fully async (Task 2), but the pure claim-gate's
 * `revealPacket` thunk is synchronous (so its bun:test stays sync — see
 * claim-gate.test.ts). So the credential check runs first and short-circuits
 * before ever touching the store for a non-credentialed caller; only once
 * credentialed do we `await store.getShip` and hand the already-resolved
 * packet to decideClaim's thunk.
 */
export async function marketClaimFlow(
  shipmentId: number,
  address: string,
): Promise<MarketClaimResult> {
  if (!address) throw new Error("address (connected wallet) required");
  const carrier = await store.getCarrier(address);
  if (!carrier.credentialed) {
    return decideClaim(false, () => undefined);
  }
  const rec = await store.getShip(shipmentId);
  if (!rec) {
    throw new Error(`no stored packet for shipment ${shipmentId} — create it via this server first`);
  }
  return decideClaim(true, () => rec.packet);
}

// ── carrier onboarding + credential gate (Spec 1 marketplace) ────────────────

/**
 * Onboard a carrier: mark `address` credentialed so it can claim from /market.
 * Idempotent — re-onboarding a credentialed carrier preserves its onboardedAt.
 *
 * PONYTAIL — demo shortcut, stated honestly. A REAL credential issuance builds
 * the depth-10 credential tree with this carrier's leaf
 *   leaf = Poseidon(DOM_CRED, pk_x, pk_y, class, payload_limit_g, expiry_ts)   (DESIGN §6.3)
 * and publishes the new epoch root via aegis-credentials `set_root(root, epoch)`,
 * which is gated by `issuer.require_auth()` (DESIGN §10.3). This server holds NO
 * Stellar signing key — least of all the issuer's — so it CANNOT sign that tx;
 * spec §13 flags this exact "credential issuance needs an admin/authorized
 * signer" risk. For the demo we record credentialed=true in the shared store and
 * leave the on-chain root untouched. `accept` still succeeds because plan-001
 * `accept` takes the A3 credential proof as OPTIONAL (DESIGN §8.2: "Without A3,
 * accept is an authorized plain call"). Real issuance is roadmap: an
 * issuer-key-holding service publishes the root out-of-band.
 */
export async function onboardCarrierFlow(address: string): Promise<CarrierStatus> {
  if (!isValidStellarAddress(address)) throw new Error("invalid Stellar address");
  const existing = await store.getCarrier(address);
  if (existing.credentialed) return existing; // idempotent — keep original onboardedAt
  await store.setCarrierCredentialed(address, Math.floor(Date.now() / 1000));
  return await store.getCarrier(address);
}

/** Carrier status for GET /api/carrier/<address>: credential flag + reputation. */
export async function carrierStatusFlow(
  address: string,
): Promise<{ credentialed: boolean; onboardedAt?: number; reputation: Reputation }> {
  if (!isValidStellarAddress(address)) throw new Error("invalid Stellar address");
  const [status, reputation] = await Promise.all([
    store.getCarrier(address),
    store.getRep(address),
  ]);
  return { credentialed: status.credentialed, onboardedAt: status.onboardedAt, reputation };
}
