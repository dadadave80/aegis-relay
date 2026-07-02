pragma circom 2.1.6;

// ---------------------------------------------------------------------------
// geocell.circom — quadtree/Morton geocell derivation (DESIGN §5.4).
//
// NORMATIVE bit order — the TS corridor tool (prover/src/authority.ts) and
// the drone simulator MUST implement the identical mapping:
//
//   lat_q, lon_q are 24-bit quantized coordinates (strictly decomposed).
//   A resolution-r cell takes the TOP r bits of each (bits 23 down to 24-r)
//   and Morton-interleaves them with the LAT bit as the HIGHER bit of each
//   pair. Writing lat_top and lon_top as r-bit values with bit j (j = 0 is
//   their LSB, i.e. original bit 24-r; j = r-1 is original bit 23):
//
//     cell = sum_{j=0}^{r-1} lat_top_bit_j * 2^(2j+1) + lon_top_bit_j * 2^(2j)
//
//   The result is a 2r-bit cell id (lat bits in odd positions, lon bits in
//   even positions).
// ---------------------------------------------------------------------------

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/poseidon.circom";
include "constants.circom";

template Cell(r) {
    signal input lat_q;
    signal input lon_q;
    signal output cell;

    // Strict 24-bit decomposition (T14) — doubles as the range check.
    component latBits = Num2Bits(24);
    latBits.in <== lat_q;
    component lonBits = Num2Bits(24);
    lonBits.in <== lon_q;

    // Interleave the top r bits: top-slice bit j is original bit (24 - r + j).
    var acc = 0;
    for (var j = 0; j < r; j++) {
        acc += latBits.out[24 - r + j] * 2 ** (2 * j + 1); // lat -> odd (higher) position
        acc += lonBits.out[24 - r + j] * 2 ** (2 * j);     // lon -> even (lower) position
    }
    cell <== acc;

    // The low 24-r bits of each coordinate are intentionally unused by the
    // cell id; they remain fully constrained inside Num2Bits (binary +
    // weighted-sum-equals-in). `_ <==` acknowledges this so --inspect stays
    // clean (T15).
    for (var j = 0; j < 24 - r; j++) {
        _ <== latBits.out[j];
        _ <== lonBits.out[j];
    }
}

// leaf = Poseidon(DOM_CELL, cell) — the geocell tree leaf (corridor and
// destination-region trees, DESIGN §5.4).
template CellLeaf(r) {
    signal input lat_q;
    signal input lon_q;
    signal output leaf;

    component cell = Cell(r);
    cell.lat_q <== lat_q;
    cell.lon_q <== lon_q;

    component h = Poseidon(2);
    h.inputs[0] <== DOM_CELL();
    h.inputs[1] <== cell.cell;
    leaf <== h.out;
}
