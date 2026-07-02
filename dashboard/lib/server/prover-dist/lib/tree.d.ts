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
/** Coordinate quantization width (DESIGN.md §5.3): lat_q/lon_q are 24-bit. */
export declare const Q_BITS = 24;
/** lat_q = floor((lat_deg + 90) / 180 · 2^24), exact integer math (§5.3). */
export declare function latToQ(latDeg: string | number): bigint;
/** lon_q = floor((lon_deg + 180) / 360 · 2^24), exact integer math (§5.3). */
export declare function lonToQ(lonDeg: string | number): bigint;
export declare function latLonToQ(latDeg: string | number, lonDeg: string | number): {
    latQ: bigint;
    lonQ: bigint;
};
/** Top `r` bits of a 24-bit quantized coordinate (bits 23 .. 24-r). */
export declare function topBits(q: bigint, r: number): bigint;
/**
 * Interleave two r-bit values into a 2r-bit Morton cell id: lat in the higher
 * (odd) bit of each pair, lon in the lower (even) bit.
 */
export declare function mortonFromTop(latTop: bigint, lonTop: bigint, r: number): bigint;
/** Resolution-`r` geocell of a quantized coordinate pair. */
export declare function mortonCell(latQ: bigint, lonQ: bigint, r: number): bigint;
export interface DestCellPath {
    /** Sibling hashes leaf→root (DEST_DEPTH entries), decimal strings. */
    pathElements: string[];
    /** Path index bits leaf→root (0 = node is left child), DEST_DEPTH entries. */
    pathIndices: number[];
}
export interface DestRegionTree {
    /** The 9 RD-resolution cell ids (decimal strings), dlat-major order. */
    cells: string[];
    /** Depth-6 Merkle root over Poseidon(DOM_CELL, cell) leaves, PAD-filled. */
    root: string;
    /** Inclusion path for each of the 9 cells (aligned with `cells`). */
    paths: DestCellPath[];
    /** Index of the recipient's own cell within `cells` (always 4). */
    centerIndex: number;
}
/**
 * The 3×3 RD-cell grid centered on (latQ,lonQ), offsetting the TOP bits by
 * ±1 in dlat-major order — the merchant's privacy dial (DESIGN.md §5.4, §8.1).
 * The center (recipient's own cell) lands at index 4, exactly as the pinned
 * fixture (gen-delivery-fixtures.mjs) constructs it.
 */
export declare function destRegionGridCells(latQ: bigint, lonQ: bigint): {
    cells: bigint[];
    centerIndex: number;
};
/** Build the depth-6 destination-region tree + a path for each of the 9 cells. */
export declare function buildDestRegionTree(latQ: bigint, lonQ: bigint): Promise<DestRegionTree>;
export interface FixedTreePath {
    index: number;
    leaf: string;
    pathElements: string[];
    pathIndices: number[];
}
export interface FixedTree {
    depth: number;
    root: string;
    /** All 2^depth leaves (real leaves then PAD fill), decimal strings. */
    leaves: string[];
    /** One inclusion path per REAL leaf (index 0 .. realLeaves.length-1). */
    paths: FixedTreePath[];
}
/**
 * Build a fixed-depth (2^depth slot) Poseidon-Merkle tree over pre-hashed
 * `realLeaves`, PAD = poseidon2(0,0) filling the unused slots. Even index =
 * left child; parent = poseidon2(left, right). Returns the root and an
 * inclusion path for every real leaf.
 */
export declare function buildFixedTree(realLeaves: Array<bigint | string>, depth: number): Promise<FixedTree>;
