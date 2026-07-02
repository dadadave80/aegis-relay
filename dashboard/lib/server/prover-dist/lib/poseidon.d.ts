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
type FieldInput = bigint | number | string;
/** Poseidon over 1..16 field inputs (circomlib parameters) → decimal string. */
export declare function poseidonHash(inputs: FieldInput[]): Promise<string>;
/** PAD = Poseidon(0, 0) — canonical zero leaf. */
export declare function pad(): Promise<string>;
/** pk_commit = Poseidon(DOM_PKC, pk_x, pk_y, pk_blind) */
export declare function pkCommit(pkX: FieldInput, pkY: FieldInput, pkBlind: FieldInput): Promise<string>;
/**
 * custody head = Poseidon2(Poseidon2(DOM_ACCEPT, shipment_id), carrier_pk_commit)
 *
 * Nested arity-2 (NOT one arity-3 hash) because the on-chain poseidon-merkle
 * crate ships only the t=3 constants; the contract computes exactly this
 * nesting via `poseidon_merkle::poseidon2` (aegis_common::custody_head).
 */
export declare function custodyHead(shipmentId: FieldInput, carrierPkCommit: FieldInput): Promise<string>;
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
export declare function computeCS(opening: ShipmentOpening): Promise<string>;
/** nullifier = Poseidon(DOM_NULL, shipment_secret) */
export declare function nullifier(shipmentSecret: FieldInput): Promise<string>;
/** cred_leaf = Poseidon(DOM_CRED, pk_x, pk_y, class, payload_limit_g, expiry_ts) */
export declare function credLeaf(pkX: FieldInput, pkY: FieldInput, credClass: FieldInput, payloadLimitG: FieldInput, expiryTs: FieldInput): Promise<string>;
/** cell_leaf = Poseidon(DOM_CELL, cell_id) */
export declare function cellLeaf(cellId: FieldInput): Promise<string>;
/** pod_msg = Poseidon(DOM_PODMSG, shipment_id, carrier_pk_commit, cell_rd, ts) */
export declare function podMsg(shipmentId: FieldInput, carrierPkCommit: FieldInput, cellRd: FieldInput, ts: FieldInput): Promise<string>;
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
export declare function flightDigest(shipmentId: FieldInput, waypoints: Waypoint[]): Promise<string[]>;
export {};
