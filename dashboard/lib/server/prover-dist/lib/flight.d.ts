/**
 * flight.ts — shared flight-log / corridor / A2-witness logic, extracted from
 * prover/scripts/gen-flight-fixtures.mjs so the authority + dronesim CLIs and
 * the e2e attack suite all build the SAME artifacts the pinned fixtures did.
 *
 * The generator script is left untouched (its committed fixture bytes are
 * frozen — hard rule 5); this module reproduces its logic independently and the
 * e2e suite deep-compares the honest witness against circuits/fixtures/flight/
 * input.json, which is the regression pin that we did not drift.
 *
 *   - Geometry (Morton geocell, quantization, fixed-depth padded Merkle) is
 *     reused from ./tree.ts — the parallel agent's owned module already carries
 *     the NORMATIVE mapping (circuits/lib/geocell.circom parity). We do NOT
 *     create a second geo module.
 *   - Poseidon hash structures (C_S, head, cell leaf, flight digest) are reused
 *     from ./poseidon.ts.
 *   - EdDSA (Baby Jubjub, digest-then-sign, DESIGN §8.3) uses circomlibjs
 *     directly, as the generator + carrier CLI do.
 *
 * Everything on the wire is a DECIMAL STRING (canonical repo form).
 */
import { type FixedTree } from './tree.js';
import { poseidonHash, type ShipmentOpening } from './poseidon.js';
export declare const N_WAYPOINTS = 16;
export declare const CORRIDOR_SAMPLES = 64;
export declare const MAX_CORRIDOR_CELLS = 300;
/** Invert a 2r-bit Morton cell back into its (latTop, lonTop) top-bit pair. */
export declare function topsFromMorton(cell: bigint, r: number): {
    latTop: bigint;
    lonTop: bigint;
};
/**
 * The sorted RC-cell cover of the straight origin→dest segment: sample the line
 * at CORRIDOR_SAMPLES points, buffer each sampled cell with its 8 top-bit
 * neighbours, dedupe, sort ascending. Byte-for-byte the generator's algorithm
 * (uses the same Number()/Math.round() interpolation so the float rounding is
 * identical).
 */
export declare function corridorCellCover(oLatQ: bigint, oLonQ: bigint, dLatQ: bigint, dLonQ: bigint): bigint[];
/** Build the depth-12 PAD-filled Poseidon tree over Poseidon(DOM_CELL, cell) leaves. */
export declare function buildCorridorTree(cells: bigint[]): Promise<FixedTree>;
export interface Corridor {
    lane_id: number;
    /** Sorted RC-cell ids (decimal strings). */
    cells: string[];
    /** Depth-12 corridor Merkle root (decimal string). */
    root: string;
    from: {
        lat: string;
        lon: string;
    };
    to: {
        lat: string;
        lon: string;
    };
}
/**
 * Author a lane corridor exactly as the generator does: quantize the endpoints,
 * cover the straight segment, build the depth-12 tree. This is what
 * `authority.ts author` writes to corridor.json.
 */
export declare function authorCorridor(laneId: number, from: {
    lat: string | number;
    lon: string | number;
}, to: {
    lat: string | number;
    lon: string | number;
}): Promise<Corridor>;
export interface DroneKey {
    seedHex: string;
    pkX: string;
    pkY: string;
    pkBlind: string;
}
/** Derive the drone signing key (pk from the 32-byte seed; pk_blind supplied). */
export declare function deriveDroneKey(seedHex: string, pkBlind: string | bigint): Promise<DroneKey>;
export interface EddsaSig {
    sig_R8x: string;
    sig_R8y: string;
    sig_S: string;
}
/** Sign a field message (decimal string) with a seed's EdDSA key (Poseidon). */
export declare function signField(seedHex: string, msg: string | bigint): Promise<EddsaSig>;
export interface WaypointArrays {
    lat_q: string[];
    lon_q: string[];
    alt_dm: string[];
    t: string[];
}
/**
 * 16 waypoints evenly interpolated origin→dest, t[i] = t0 + dt·i, flat altitude.
 * Identical Number()/Math.round() interpolation as the generator; the final
 * waypoint MUST land exactly on the destination cell.
 */
export declare function interpolateWaypoints(oLatQ: bigint, oLonQ: bigint, dLatQ: bigint, dLonQ: bigint, opts: {
    n?: number;
    t0: bigint;
    dt: bigint;
    altDm: bigint;
}): WaypointArrays;
/**
 * Numeric pre-prover checks the honest drone runs before it wastes 2–5 min on a
 * proof (DESIGN §5.5): strict time monotonicity, gap ≤ GAP_MAX, speed bound,
 * altitude cap, payload cap. Attack modes deliberately bypass these.
 */
export declare function preAssertLog(wp: WaypointArrays, weightG: bigint): void;
/** d_16 over shipment_id + the 16 waypoints (Poseidon chain), decimal string. */
export declare function computeFlightDigest(shipmentId: string | bigint, wp: WaypointArrays): Promise<string>;
/** The A2 witness object; keys mirror circuits/fixtures/flight/input.json. */
export type FlightWitness = Record<string, string | string[] | string[][]>;
export interface FlightScenarioParams {
    shipmentId: string | number | bigint;
    /** C_S opening (origin_cell + dest_region_root are recomputed from geometry). */
    opening: Omit<ShipmentOpening, 'originCell' | 'destRegionRoot'>;
    /** WGS84 endpoints as decimal-degree strings/numbers. */
    from: {
        lat: string | number;
        lon: string | number;
    };
    to: {
        lat: string | number;
        lon: string | number;
    };
    droneKey: DroneKey;
    laneId: number;
    /** Log shape (defaults match the frozen fixture: n=16, dt=20, alt=800). */
    n?: number;
    t0: bigint;
    dt: bigint;
    altDm: bigint;
}
export interface FlightScenario {
    witness: FlightWitness;
    corridor: Corridor;
    corridorTree: FixedTree;
    corridorCells: bigint[];
    waypoints: WaypointArrays;
    d16: string;
    cs: string;
    head: string;
    carrierPkCommit: string;
    originCell: string;
    destRegionRoot: string;
    cellRd: string;
}
/**
 * Build the honest flight scenario (corridor, dest region, C_S, head, digest,
 * drone signature, full witness) exactly as gen-flight-fixtures.mjs. Runs the
 * §5.5 pre-asserts. Attack modes are applied AFTER, by `applyAttack`, on the
 * returned witness (so each attack isolates the single constraint it breaks).
 */
export declare function buildFlightScenario(p: FlightScenarioParams): Promise<FlightScenario>;
export type AttackMode = 'none' | 'stray' | 'teleport' | 'gap' | 'nonmono' | 'splice' | 'heavy' | 'altitude' | 'foreign-key';
export declare const ATTACK_MODES: AttackMode[];
/** One-line description of what each mode does and which gate it must trip. */
export declare const ATTACK_NOTES: Record<AttackMode, string>;
export interface AttackContext {
    /** Honest scenario (for the corridor tree used by teleport re-pathing). */
    scenario: FlightScenario;
    /** Drone seed used for honest / re-signing mutations. */
    droneSeedHex: string;
    /** A DIFFERENT seed used only by the foreign-key attack. */
    foreignSeedHex: string;
    /** Index of the waypoint attacks mutate (default 8, matching flight.test). */
    wpIndex?: number;
}
/**
 * Apply an attack mutation to the honest witness. Returns the mutated witness;
 * `none` returns the honest witness unchanged. Each mutation mirrors
 * circuits/test/flight.test.mjs so the e2e suite proves the SAME attacks the
 * circuit suite pins are unprovable end-to-end.
 */
export declare function applyAttack(mode: AttackMode, ctx: AttackContext): Promise<FlightWitness>;
export { poseidonHash };
