/**
 * tree.ts — geocell Morton mapping + fixed-depth padded Poseidon-Merkle builder.
 *
 * Two concerns live here, both feeding the destination-region commitment
 * (DESIGN.md §5.4, §6.1); one owned module keeps the geometry and the tree
 * convention in lockstep with the circuit and the Rust crate.
 *
 *   1. GEOCELL (NORMATIVE — must match circuits/lib/geocell.circom and
 *      prover/scripts/gen-delivery-fixtures.mjs): quantize a WGS84 (lat,lon) to
 *      24-bit `lat_q`/`lon_q`, then interleave the TOP `r` bits of each in Morton
 *      order — lat in the HIGHER (odd) bit of every pair — into a `2r`-bit cell
 *      id. `topBits(q,r) = q >> (24 - r)`.
 *
 *   2. FIXED-DEPTH MERKLE: 2^depth leaf slots, PAD = poseidon2(0,0) fill, even
 *      index = left child, parent = poseidon2(left,right). Identical convention
 *      to the Rust `poseidon-merkle` crate, `merkle_fixed.circom`, and the
 *      fixture builder (cross-checked against circuits/fixtures/delivery).
 *
 * Wire form: hashes/cells are DECIMAL STRINGs (canonical repo form). `lat_q`,
 * `lon_q`, and cell ids are handled as bigints internally (they never exceed
 * 2^24 / 2^48 respectively).
 */
import { buildPoseidon } from 'circomlibjs';
import { DOM_CELL, RD_RES, DEST_DEPTH } from './constants.js';
// circomlibjs ships no types; the poseidon instance is callable with `.F`.
let poseidonInstance = null;
async function getPoseidon() {
    if (poseidonInstance === null)
        poseidonInstance = await buildPoseidon();
    return poseidonInstance;
}
// ── Geocell mapping ─────────────────────────────────────────────────────────
/** Coordinate quantization width (DESIGN.md §5.3): lat_q/lon_q are 24-bit. */
export const Q_BITS = 24;
const Q_MAX = (1n << 24n) - 1n;
const Q_SCALE = 10n ** 7n; // 7-decimal fixed-point for degree parsing
/** Parse a decimal degree string/number into a 10^7-scaled signed bigint. */
function degScaled(deg) {
    const str = (typeof deg === 'number' ? deg.toString() : deg).trim();
    const neg = str.startsWith('-');
    const body = neg ? str.slice(1) : str;
    const [intPart = '0', fracRaw = ''] = body.split('.');
    const frac = (fracRaw + '0000000').slice(0, 7);
    const scaled = BigInt(intPart || '0') * Q_SCALE + BigInt(frac || '0');
    return neg ? -scaled : scaled;
}
const clampQ = (q) => (q < 0n ? 0n : q > Q_MAX ? Q_MAX : q);
/** lat_q = floor((lat_deg + 90) / 180 · 2^24), exact integer math (§5.3). */
export function latToQ(latDeg) {
    const s = degScaled(latDeg);
    return clampQ(((s + 90n * Q_SCALE) * (1n << 24n)) / (180n * Q_SCALE));
}
/** lon_q = floor((lon_deg + 180) / 360 · 2^24), exact integer math (§5.3). */
export function lonToQ(lonDeg) {
    const s = degScaled(lonDeg);
    return clampQ(((s + 180n * Q_SCALE) * (1n << 24n)) / (360n * Q_SCALE));
}
export function latLonToQ(latDeg, lonDeg) {
    return { latQ: latToQ(latDeg), lonQ: lonToQ(lonDeg) };
}
/** Top `r` bits of a 24-bit quantized coordinate (bits 23 .. 24-r). */
export function topBits(q, r) {
    return q >> BigInt(Q_BITS - r);
}
/**
 * Interleave two r-bit values into a 2r-bit Morton cell id: lat in the higher
 * (odd) bit of each pair, lon in the lower (even) bit.
 */
export function mortonFromTop(latTop, lonTop, r) {
    let cell = 0n;
    for (let j = 0n; j < BigInt(r); j++) {
        cell |= ((latTop >> j) & 1n) << (2n * j + 1n);
        cell |= ((lonTop >> j) & 1n) << (2n * j);
    }
    return cell;
}
/** Resolution-`r` geocell of a quantized coordinate pair. */
export function mortonCell(latQ, lonQ, r) {
    return mortonFromTop(topBits(latQ, r), topBits(lonQ, r), r);
}
/**
 * The 3×3 RD-cell grid centered on (latQ,lonQ), offsetting the TOP bits by
 * ±1 in dlat-major order — the merchant's privacy dial (DESIGN.md §5.4, §8.1).
 * The center (recipient's own cell) lands at index 4, exactly as the pinned
 * fixture (gen-delivery-fixtures.mjs) constructs it.
 */
export function destRegionGridCells(latQ, lonQ) {
    const latTop = topBits(latQ, RD_RES);
    const lonTop = topBits(lonQ, RD_RES);
    const cells = [];
    for (const dlat of [-1n, 0n, 1n]) {
        for (const dlon of [-1n, 0n, 1n]) {
            cells.push(mortonFromTop(latTop + dlat, lonTop + dlon, RD_RES));
        }
    }
    return { cells, centerIndex: 4 };
}
/** Build the depth-6 destination-region tree + a path for each of the 9 cells. */
export async function buildDestRegionTree(latQ, lonQ) {
    const { cells, centerIndex } = destRegionGridCells(latQ, lonQ);
    const p = await getPoseidon();
    const leaf = (cell) => p.F.toString(p([DOM_CELL, cell]));
    const realLeaves = cells.map(leaf);
    const tree = await buildFixedTree(realLeaves, DEST_DEPTH);
    return {
        cells: cells.map((c) => c.toString()),
        root: tree.root,
        paths: cells.map((_, i) => ({
            pathElements: tree.paths[i].pathElements,
            pathIndices: tree.paths[i].pathIndices,
        })),
        centerIndex,
    };
}
/**
 * Build a fixed-depth (2^depth slot) Poseidon-Merkle tree over pre-hashed
 * `realLeaves`, PAD = poseidon2(0,0) filling the unused slots. Even index =
 * left child; parent = poseidon2(left, right). Returns the root and an
 * inclusion path for every real leaf.
 */
export async function buildFixedTree(realLeaves, depth) {
    const slots = 1 << depth;
    if (realLeaves.length > slots) {
        throw new Error(`too many leaves: ${realLeaves.length} > 2^${depth} = ${slots}`);
    }
    const p = await getPoseidon();
    const h2 = (a, b) => p.F.toString(p([BigInt(a), BigInt(b)]));
    const PAD = h2('0', '0');
    const leaves = realLeaves.map((l) => BigInt(l).toString());
    while (leaves.length < slots)
        leaves.push(PAD);
    // Build level by level: levels[0] = leaves, levels[depth] = [root].
    const levels = [leaves];
    let cur = leaves;
    while (cur.length > 1) {
        const next = [];
        for (let i = 0; i < cur.length; i += 2)
            next.push(h2(cur[i], cur[i + 1]));
        levels.push(next);
        cur = next;
    }
    const root = levels[depth][0];
    const paths = realLeaves.map((_, index) => {
        const pathElements = [];
        const pathIndices = [];
        let idx = index;
        for (let lvl = 0; lvl < depth; lvl++) {
            const sib = (idx & 1) === 0 ? idx + 1 : idx - 1;
            pathElements.push(levels[lvl][sib]);
            pathIndices.push(idx & 1);
            idx >>= 1;
        }
        return { index, leaf: leaves[index], pathElements, pathIndices };
    });
    return { depth, root, leaves, paths };
}
