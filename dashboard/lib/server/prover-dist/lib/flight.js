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
import { buildEddsa } from 'circomlibjs';
import { GAP_MAX_SEC, ALT_MAX_DM, VMAX_U, RC_RES, RD_RES, CORRIDOR_DEPTH, DRONE_MAX_G, } from './constants.js';
import { latLonToQ, mortonFromTop, mortonCell, buildFixedTree, buildDestRegionTree, } from './tree.js';
import { poseidonHash, computeCS, custodyHead, pkCommit, cellLeaf, flightDigest, } from './poseidon.js';
// ── Frozen simulator defaults (DESIGN §5.5; parity with the generator) ───────
export const N_WAYPOINTS = 16;
export const CORRIDOR_SAMPLES = 64;
export const MAX_CORRIDOR_CELLS = 300;
// circomlibjs ships no types; the eddsa instance is callable via helpers.
let eddsaInstance = null;
async function getEddsa() {
    if (eddsaInstance === null)
        eddsaInstance = await buildEddsa();
    return eddsaInstance;
}
// ── Corridor cell cover (generator parity — 64 samples + 8-neighbour buffer) ──
/** Invert a 2r-bit Morton cell back into its (latTop, lonTop) top-bit pair. */
export function topsFromMorton(cell, r) {
    let latTop = 0n;
    let lonTop = 0n;
    for (let j = 0n; j < BigInt(r); j++) {
        latTop |= ((cell >> (2n * j + 1n)) & 1n) << j;
        lonTop |= ((cell >> (2n * j)) & 1n) << j;
    }
    return { latTop, lonTop };
}
/**
 * The sorted RC-cell cover of the straight origin→dest segment: sample the line
 * at CORRIDOR_SAMPLES points, buffer each sampled cell with its 8 top-bit
 * neighbours, dedupe, sort ascending. Byte-for-byte the generator's algorithm
 * (uses the same Number()/Math.round() interpolation so the float rounding is
 * identical).
 */
export function corridorCellCover(oLatQ, oLonQ, dLatQ, dLonQ) {
    const dLat = Number(dLatQ - oLatQ);
    const dLon = Number(dLonQ - oLonQ);
    const cellSet = new Set();
    for (let k = 0; k < CORRIDOR_SAMPLES; k++) {
        const sLat = oLatQ + BigInt(Math.round((dLat * k) / (CORRIDOR_SAMPLES - 1)));
        const sLon = oLonQ + BigInt(Math.round((dLon * k) / (CORRIDOR_SAMPLES - 1)));
        cellSet.add(mortonCell(sLat, sLon, RC_RES).toString());
    }
    // Buffer over the ORIGINAL line cells only (snapshot, not the neighbours).
    for (const c of [...cellSet]) {
        const { latTop, lonTop } = topsFromMorton(BigInt(c), RC_RES);
        for (const da of [-1n, 0n, 1n]) {
            for (const do_ of [-1n, 0n, 1n]) {
                cellSet.add(mortonFromTop(latTop + da, lonTop + do_, RC_RES).toString());
            }
        }
    }
    const cells = [...cellSet].map(BigInt).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (cells.length > MAX_CORRIDOR_CELLS) {
        throw new Error(`corridor too large: ${cells.length} cells > ${MAX_CORRIDOR_CELLS}`);
    }
    if (cells.length > 2 ** CORRIDOR_DEPTH)
        throw new Error('corridor overflows the depth-12 tree');
    return cells;
}
/** Build the depth-12 PAD-filled Poseidon tree over Poseidon(DOM_CELL, cell) leaves. */
export async function buildCorridorTree(cells) {
    const leaves = [];
    for (const c of cells)
        leaves.push(await cellLeaf(c));
    return buildFixedTree(leaves, CORRIDOR_DEPTH);
}
/**
 * Author a lane corridor exactly as the generator does: quantize the endpoints,
 * cover the straight segment, build the depth-12 tree. This is what
 * `authority.ts author` writes to corridor.json.
 */
export async function authorCorridor(laneId, from, to) {
    const o = latLonToQ(from.lat, from.lon);
    const d = latLonToQ(to.lat, to.lon);
    const cells = corridorCellCover(o.latQ, o.lonQ, d.latQ, d.lonQ);
    const tree = await buildCorridorTree(cells);
    return {
        lane_id: laneId,
        cells: cells.map((c) => c.toString()),
        root: tree.root,
        from: { lat: String(from.lat), lon: String(from.lon) },
        to: { lat: String(to.lat), lon: String(to.lon) },
    };
}
/** Derive the drone signing key (pk from the 32-byte seed; pk_blind supplied). */
export async function deriveDroneKey(seedHex, pkBlind) {
    const eddsa = await getEddsa();
    const bjF = eddsa.babyJub.F;
    const [x, y] = eddsa.prv2pub(Buffer.from(seedHex, 'hex'));
    return {
        seedHex,
        pkX: bjF.toObject(x).toString(),
        pkY: bjF.toObject(y).toString(),
        pkBlind: BigInt(pkBlind).toString(),
    };
}
/** Sign a field message (decimal string) with a seed's EdDSA key (Poseidon). */
export async function signField(seedHex, msg) {
    const eddsa = await getEddsa();
    const bjF = eddsa.babyJub.F;
    const sig = eddsa.signPoseidon(Buffer.from(seedHex, 'hex'), bjF.e(BigInt(msg)));
    return {
        sig_R8x: bjF.toObject(sig.R8[0]).toString(),
        sig_R8y: bjF.toObject(sig.R8[1]).toString(),
        sig_S: sig.S.toString(),
    };
}
/**
 * 16 waypoints evenly interpolated origin→dest, t[i] = t0 + dt·i, flat altitude.
 * Identical Number()/Math.round() interpolation as the generator; the final
 * waypoint MUST land exactly on the destination cell.
 */
export function interpolateWaypoints(oLatQ, oLonQ, dLatQ, dLonQ, opts) {
    const n = opts.n ?? N_WAYPOINTS;
    const dLat = Number(dLatQ - oLatQ);
    const dLon = Number(dLonQ - oLonQ);
    const lat_q = [];
    const lon_q = [];
    const alt_dm = [];
    const t = [];
    for (let i = 0; i < n; i++) {
        lat_q.push((oLatQ + BigInt(Math.round((dLat * i) / (n - 1)))).toString());
        lon_q.push((oLonQ + BigInt(Math.round((dLon * i) / (n - 1)))).toString());
        alt_dm.push(opts.altDm.toString());
        t.push((opts.t0 + opts.dt * BigInt(i)).toString());
    }
    if (BigInt(lat_q[n - 1]) !== dLatQ || BigInt(lon_q[n - 1]) !== dLonQ) {
        throw new Error('final waypoint must be exactly the destination');
    }
    return { lat_q, lon_q, alt_dm, t };
}
/**
 * Numeric pre-prover checks the honest drone runs before it wastes 2–5 min on a
 * proof (DESIGN §5.5): strict time monotonicity, gap ≤ GAP_MAX, speed bound,
 * altitude cap, payload cap. Attack modes deliberately bypass these.
 */
export function preAssertLog(wp, weightG) {
    const n = wp.t.length;
    for (let i = 1; i < n; i++) {
        const ti = BigInt(wp.t[i]);
        const tp = BigInt(wp.t[i - 1]);
        if (ti <= tp)
            throw new Error(`non-monotonic t at ${i}`);
        const dt = ti - tp;
        if (dt > BigInt(GAP_MAX_SEC))
            throw new Error(`gap ${dt} > GAP_MAX at ${i}`);
        const dlat = BigInt(wp.lat_q[i]) - BigInt(wp.lat_q[i - 1]);
        const dlon = BigInt(wp.lon_q[i]) - BigInt(wp.lon_q[i - 1]);
        const lhs = dlat * dlat + 4n * dlon * dlon;
        const rhs = (BigInt(VMAX_U) * dt) ** 2n;
        if (lhs > rhs)
            throw new Error(`SPEED BOUND VIOLATED at pair ${i}: ${lhs} > ${rhs}`);
    }
    for (const a of wp.alt_dm)
        if (BigInt(a) > BigInt(ALT_MAX_DM))
            throw new Error('altitude bust');
    if (weightG > BigInt(DRONE_MAX_G))
        throw new Error('overweight');
}
// ── The running flight digest d_16 (DESIGN §8.3) ─────────────────────────────
/** d_16 over shipment_id + the 16 waypoints (Poseidon chain), decimal string. */
export async function computeFlightDigest(shipmentId, wp) {
    const digests = await flightDigest(shipmentId, wp.lat_q.map((_, i) => ({
        latQ: wp.lat_q[i],
        lonQ: wp.lon_q[i],
        altDm: wp.alt_dm[i],
        t: wp.t[i],
    })));
    return digests[digests.length - 1];
}
/**
 * Build the honest flight scenario (corridor, dest region, C_S, head, digest,
 * drone signature, full witness) exactly as gen-flight-fixtures.mjs. Runs the
 * §5.5 pre-asserts. Attack modes are applied AFTER, by `applyAttack`, on the
 * returned witness (so each attack isolates the single constraint it breaks).
 */
export async function buildFlightScenario(p) {
    const shipmentId = BigInt(p.shipmentId).toString();
    const o = latLonToQ(p.from.lat, p.from.lon);
    const d = latLonToQ(p.to.lat, p.to.lon);
    // Waypoints + honest pre-asserts.
    const wp = interpolateWaypoints(o.latQ, o.lonQ, d.latQ, d.lonQ, {
        n: p.n,
        t0: p.t0,
        dt: p.dt,
        altDm: p.altDm,
    });
    preAssertLog(wp, BigInt(p.opening.weightG));
    // Corridor cover + tree.
    const corridorCells = corridorCellCover(o.latQ, o.lonQ, d.latQ, d.lonQ);
    const corridorTree = await buildCorridorTree(corridorCells);
    const corridorIndex = new Map(corridorCells.map((c, i) => [c.toString(), i]));
    // Destination region (3×3 RD grid, depth-6, center = own cell) — reuse tree.ts.
    const destTree = await buildDestRegionTree(d.latQ, d.lonQ);
    const destRegionRoot = destTree.root;
    const cellRd = mortonCell(d.latQ, d.lonQ, RD_RES).toString();
    const originCell = mortonCell(o.latQ, o.lonQ, RC_RES).toString();
    if (originCell !== mortonCell(BigInt(wp.lat_q[0]), BigInt(wp.lon_q[0]), RC_RES).toString()) {
        throw new Error('waypoint 0 cell != origin_cell');
    }
    // Every waypoint's RC cell must be inside the corridor set.
    const n = wp.lat_q.length;
    const corridorPath = [];
    const corridorPathIndex = [];
    for (let i = 0; i < n; i++) {
        const c = mortonCell(BigInt(wp.lat_q[i]), BigInt(wp.lon_q[i]), RC_RES).toString();
        const idx = corridorIndex.get(c);
        if (idx === undefined)
            throw new Error(`waypoint ${i} cell ${c} not in corridor`);
        corridorPath.push(corridorTree.paths[idx].pathElements);
        corridorPathIndex.push(corridorTree.paths[idx].pathIndices.map(String));
    }
    // Commitments.
    const fullOpening = { ...p.opening, originCell, destRegionRoot };
    const cs = await computeCS(fullOpening);
    const carrierPkCommit = await pkCommit(p.droneKey.pkX, p.droneKey.pkY, p.droneKey.pkBlind);
    const head = await custodyHead(shipmentId, carrierPkCommit);
    // Flight digest + drone signature (digest-then-sign).
    const d16 = await computeFlightDigest(shipmentId, wp);
    const sig = await signField(p.droneKey.seedHex, d16);
    const dest = destTree.paths[destTree.centerIndex];
    const witness = {
        shipment_id: shipmentId,
        c_s: cs,
        head,
        corridor_root: corridorTree.root,
        t_0: wp.t[0],
        t_n: wp.t[n - 1],
        sku_hash: String(p.opening.skuHash),
        qty: String(p.opening.qty),
        weight_g: String(p.opening.weightG),
        value_units: String(p.opening.valueUnits),
        origin_cell: originCell,
        dest_region_root: destRegionRoot,
        recipient_pk_x: String(p.opening.recipientPkX),
        recipient_pk_y: String(p.opening.recipientPkY),
        method: String(p.opening.method),
        deadline_ts: String(p.opening.deadlineTs),
        shipment_secret: String(p.opening.shipmentSecret),
        pk_x: p.droneKey.pkX,
        pk_y: p.droneKey.pkY,
        pk_blind: p.droneKey.pkBlind,
        sig_R8x: sig.sig_R8x,
        sig_R8y: sig.sig_R8y,
        sig_S: sig.sig_S,
        lat_q: wp.lat_q,
        lon_q: wp.lon_q,
        alt_dm: wp.alt_dm,
        t: wp.t,
        corridor_path: corridorPath,
        corridor_index: corridorPathIndex,
        dest_path: dest.pathElements,
        dest_index: dest.pathIndices.map(String),
    };
    return {
        witness,
        corridor: {
            lane_id: p.laneId,
            cells: corridorCells.map((c) => c.toString()),
            root: corridorTree.root,
            from: { lat: String(p.from.lat), lon: String(p.from.lon) },
            to: { lat: String(p.to.lat), lon: String(p.to.lon) },
        },
        corridorTree,
        corridorCells,
        waypoints: wp,
        d16,
        cs,
        head,
        carrierPkCommit,
        originCell,
        destRegionRoot,
        cellRd,
    };
}
export const ATTACK_MODES = [
    'stray',
    'teleport',
    'gap',
    'nonmono',
    'splice',
    'heavy',
    'altitude',
    'foreign-key',
];
/** One-line description of what each mode does and which gate it must trip. */
export const ATTACK_NOTES = {
    none: 'honest compliant flight',
    stray: 'waypoint 8 moved 3 RC-cells off-corridor → corridor membership fails',
    teleport: '900-unit lat jump at dt=20 → §5.5 speed bound fails',
    gap: 't[8] = t[7] + 45 > GAP_MAX(30) → gap check fails',
    nonmono: 't[8] < t[7] → strict monotonicity / dt-bit-pin fails',
    splice: 'shipment-2 log replayed as shipment_id=3 → head/C_S openings + signature die (T7)',
    heavy: 'weight_g = 6000 > DRONE_MAX_G(5000) → payload cap fails',
    altitude: 'alt_dm[8] = 1500 > ALT_MAX(1200) → altitude cap fails',
    'foreign-key': 'd16 signed by a non-custodian key → in-circuit EdDSA verify fails',
};
/** Recompute d_16 over a (possibly mutated) witness and re-sign with `seedHex`. */
async function resign(w, seedHex) {
    const wp = {
        lat_q: w.lat_q,
        lon_q: w.lon_q,
        alt_dm: w.alt_dm,
        t: w.t,
    };
    const d16 = await computeFlightDigest(w.shipment_id, wp);
    const sig = await signField(seedHex, d16);
    return { ...w, ...sig };
}
/**
 * Apply an attack mutation to the honest witness. Returns the mutated witness;
 * `none` returns the honest witness unchanged. Each mutation mirrors
 * circuits/test/flight.test.mjs so the e2e suite proves the SAME attacks the
 * circuit suite pins are unprovable end-to-end.
 */
export async function applyAttack(mode, ctx) {
    const honest = ctx.scenario.witness;
    const i = ctx.wpIndex ?? 8;
    const drone = ctx.droneSeedHex;
    switch (mode) {
        case 'none':
            return honest;
        case 'stray': {
            // +3 RC-cells east (1 RC cell in lon_q ≈ 2^(24-15) = 512 units). Honest
            // corridor path for wp[i] is kept → the strayed cell has no valid path.
            const lonQ = BigInt(honest.lon_q[i]) + 3n * 2n ** BigInt(24 - RC_RES);
            const lon_q = honest.lon_q.map((v, k) => (k === i ? lonQ.toString() : v));
            return resign({ ...honest, lon_q }, drone);
        }
        case 'teleport': {
            // 900-unit lat jump; the jumped cell deliberately STAYS in the corridor
            // (re-pathed) so the ONLY failing constraint is the speed bound.
            const latQ = BigInt(honest.lat_q[i]) + 900n;
            const newCell = mortonCell(latQ, BigInt(honest.lon_q[i]), RC_RES);
            const cellIdx = ctx.scenario.corridorCells.findIndex((c) => c === newCell);
            if (cellIdx === -1)
                throw new Error('teleport target cell is not in the corridor');
            const path = ctx.scenario.corridorTree.paths[cellIdx];
            const lat_q = honest.lat_q.map((v, k) => (k === i ? latQ.toString() : v));
            const corridor_path = honest.corridor_path.map((p, k) => k === i ? path.pathElements : p);
            const corridor_index = honest.corridor_index.map((p, k) => k === i ? path.pathIndices.map(String) : p);
            return resign({ ...honest, lat_q, corridor_path, corridor_index }, drone);
        }
        case 'gap': {
            // t[i] = t[i-1] + 45 (> GAP_MAX); tail shifted so later gaps stay 20 s.
            const t = honest.t.map((v, k) => k < i ? v : (BigInt(honest.t[i - 1]) + 45n + 20n * BigInt(k - i)).toString());
            return resign({ ...honest, t, t_n: t[t.length - 1] }, drone);
        }
        case 'nonmono': {
            // t[i] = t[i-1] - 5 (rolls backwards); tail re-based; strict-mono fails.
            const t = honest.t.map((v, k) => k < i ? v : (BigInt(honest.t[i - 1]) - 5n + 20n * BigInt(k - i)).toString());
            return resign({ ...honest, t, t_n: t[t.length - 1] }, drone);
        }
        case 'splice': {
            // Replay shipment-2's honest log under shipment_id=3, ORIGINAL signature
            // kept (attacker lacks the drone key). d_0 changes → sig + head + C_S die.
            return { ...honest, shipment_id: '3' };
        }
        case 'heavy': {
            // weight_g lives in C_S, not the log — recompute c_s over the heavy
            // opening so the C_S equation holds and only the payload cap fails.
            const heavy = 6000n;
            const cs = await computeCS({
                skuHash: honest.sku_hash,
                qty: honest.qty,
                weightG: heavy,
                valueUnits: honest.value_units,
                originCell: honest.origin_cell,
                destRegionRoot: honest.dest_region_root,
                recipientPkX: honest.recipient_pk_x,
                recipientPkY: honest.recipient_pk_y,
                method: honest.method,
                deadlineTs: honest.deadline_ts,
                shipmentSecret: honest.shipment_secret,
            });
            return { ...honest, weight_g: heavy.toString(), c_s: cs };
        }
        case 'altitude': {
            // alt_dm[i] = 1500 (> ALT_MAX); re-signed so only the altitude cap fails.
            const alt_dm = honest.alt_dm.map((v, k) => (k === i ? '1500' : v));
            return resign({ ...honest, alt_dm }, drone);
        }
        case 'foreign-key': {
            // Honest digest, signed by a DIFFERENT seed; the witness keeps the drone
            // pk (opened for the head) → in-circuit EdDSA verify rejects.
            return resign(honest, ctx.foreignSeedHex);
        }
        default: {
            const _exhaustive = mode;
            throw new Error(`unknown attack mode: ${_exhaustive}`);
        }
    }
}
export { poseidonHash };
