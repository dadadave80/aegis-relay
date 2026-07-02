pragma circom 2.1.6;

// Test harness: Cell(15) + CellLeaf(15) — RC corridor resolution.

include "../../lib/geocell.circom";

template GeoMain(r) {
    signal input lat_q;
    signal input lon_q;
    signal output cell;
    signal output leaf;

    component c = Cell(r);
    c.lat_q <== lat_q;
    c.lon_q <== lon_q;
    cell <== c.cell;

    component cl = CellLeaf(r);
    cl.lat_q <== lat_q;
    cl.lon_q <== lon_q;
    leaf <== cl.leaf;
}

component main = GeoMain(15);
