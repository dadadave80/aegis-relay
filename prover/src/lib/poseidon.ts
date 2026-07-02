/**
 * poseidon.ts — async wrapper around circomlibjs `buildPoseidon()` with one
 * named helper per normative hash structure (DESIGN.md §5/§6).
 *
 * Every helper returns the hash as a DECIMAL STRING (the canonical wire form
 * across the fixture, circuits, and contract tests). All domain tags come
 * from `constants.ts` — never inline a tag here.
 *
 * Parity is enforced against fixtures/parity.json by poseidon.test.ts.
 */

import { buildPoseidon } from 'circomlibjs';
import {
  DOM_SHIP,
  DOM_ACCEPT,
  DOM_PODMSG,
  DOM_NULL,
  DOM_PKC,
  DOM_CRED,
  DOM_CELL,
  DOM_FLIGHT,
} from './constants.js';

type FieldInput = bigint | number | string;

// circomlibjs has no bundled types; the poseidon instance is callable and
// carries its field helper on `.F`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let poseidonInstance: any = null;

async function getPoseidon() {
  if (poseidonInstance === null) {
    poseidonInstance = await buildPoseidon();
  }
  return poseidonInstance;
}

/** Poseidon over 1..16 field inputs (circomlib parameters) → decimal string. */
export async function poseidonHash(inputs: FieldInput[]): Promise<string> {
  const p = await getPoseidon();
  return p.F.toString(p(inputs.map((v) => BigInt(v))));
}

/** PAD = Poseidon(0, 0) — canonical zero leaf. */
export async function pad(): Promise<string> {
  return poseidonHash([0n, 0n]);
}

/** pk_commit = Poseidon(DOM_PKC, pk_x, pk_y, pk_blind) */
export async function pkCommit(
  pkX: FieldInput,
  pkY: FieldInput,
  pkBlind: FieldInput,
): Promise<string> {
  return poseidonHash([DOM_PKC, pkX, pkY, pkBlind]);
}

/**
 * custody head = Poseidon2(Poseidon2(DOM_ACCEPT, shipment_id), carrier_pk_commit)
 *
 * Nested arity-2 (NOT one arity-3 hash) because the on-chain poseidon-merkle
 * crate ships only the t=3 constants; the contract computes exactly this
 * nesting via `poseidon_merkle::poseidon2` (aegis_common::custody_head).
 */
export async function custodyHead(
  shipmentId: FieldInput,
  carrierPkCommit: FieldInput,
): Promise<string> {
  const inner = await poseidonHash([DOM_ACCEPT, shipmentId]);
  return poseidonHash([inner, carrierPkCommit]);
}

/** Full private opening of the shipment commitment C_S (DESIGN.md §6.1). */
export interface ShipmentOpening {
  skuHash: FieldInput;
  qty: FieldInput;
  weightG: FieldInput;
  valueUnits: FieldInput;
  originCell: FieldInput;
  destRegionRoot: FieldInput;
  recipientPkX: FieldInput;
  recipientPkY: FieldInput;
  method: FieldInput;
  deadlineTs: FieldInput;
  shipmentSecret: FieldInput;
}

/** C_S = Poseidon(DOM_SHIP, ...opening) — single 12-input Poseidon. */
export async function computeCS(opening: ShipmentOpening): Promise<string> {
  return poseidonHash([
    DOM_SHIP,
    opening.skuHash,
    opening.qty,
    opening.weightG,
    opening.valueUnits,
    opening.originCell,
    opening.destRegionRoot,
    opening.recipientPkX,
    opening.recipientPkY,
    opening.method,
    opening.deadlineTs,
    opening.shipmentSecret,
  ]);
}

/** nullifier = Poseidon(DOM_NULL, shipment_secret) */
export async function nullifier(shipmentSecret: FieldInput): Promise<string> {
  return poseidonHash([DOM_NULL, shipmentSecret]);
}

/** cred_leaf = Poseidon(DOM_CRED, pk_x, pk_y, class, payload_limit_g, expiry_ts) */
export async function credLeaf(
  pkX: FieldInput,
  pkY: FieldInput,
  credClass: FieldInput,
  payloadLimitG: FieldInput,
  expiryTs: FieldInput,
): Promise<string> {
  return poseidonHash([DOM_CRED, pkX, pkY, credClass, payloadLimitG, expiryTs]);
}

/** cell_leaf = Poseidon(DOM_CELL, cell_id) */
export async function cellLeaf(cellId: FieldInput): Promise<string> {
  return poseidonHash([DOM_CELL, cellId]);
}

/** pod_msg = Poseidon(DOM_PODMSG, shipment_id, carrier_pk_commit, cell_rd, ts) */
export async function podMsg(
  shipmentId: FieldInput,
  carrierPkCommit: FieldInput,
  cellRd: FieldInput,
  ts: FieldInput,
): Promise<string> {
  return poseidonHash([DOM_PODMSG, shipmentId, carrierPkCommit, cellRd, ts]);
}

export interface Waypoint {
  latQ: FieldInput;
  lonQ: FieldInput;
  altDm: FieldInput;
  t: FieldInput;
}

/**
 * Flight-log running digest:
 *   d0 = Poseidon(DOM_FLIGHT, shipment_id)
 *   d_i = Poseidon(d_{i-1}, lat_q, lon_q, alt_dm, t_i)
 *
 * Returns [d0, d1, …, dn] (n = waypoints.length) as decimal strings.
 */
export async function flightDigest(
  shipmentId: FieldInput,
  waypoints: Waypoint[],
): Promise<string[]> {
  const digests: string[] = [await poseidonHash([DOM_FLIGHT, shipmentId])];
  for (const wp of waypoints) {
    digests.push(
      await poseidonHash([digests[digests.length - 1], wp.latQ, wp.lonQ, wp.altDm, wp.t]),
    );
  }
  return digests;
}
