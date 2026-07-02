pragma circom 2.1.6;

// parity.circom — cross-stack Poseidon parity harness (NOT a production
// circuit; no range checks, no membership gadgets — hashing only).
//
// Takes the raw sample values from fixtures/parity.json and recomputes the
// normative hash structures 2–8 and the flight digest d2 (DESIGN.md §5/§6)
// with circomlib Poseidon, so circuits/test/parity.test.mjs can assert every
// output against the fixture decimals pinned by prover/scripts/gen-parity.mjs.
//
// Compile via `node circuits/build.mjs compile` (-l circuits/node_modules
// resolves the include below).

include "circomlib/circuits/poseidon.circom";

template Parity() {
    // DOM tags (DESIGN.md §5.2) — keep identical to
    // contracts/aegis-common/src/lib.rs and prover/src/lib/constants.ts.
    var DOM_SHIP   = 1;
    var DOM_ACCEPT = 2;
    var DOM_PODMSG = 5;
    var DOM_NULL   = 6;
    var DOM_PKC    = 7;
    var DOM_CRED   = 8;
    var DOM_CELL   = 9;
    var DOM_FLIGHT = 10;

    // ── raw sample inputs (names match fixtures/parity.json) ────────────────
    signal input pk_x;             // carrier Baby Jubjub key
    signal input pk_y;
    signal input pk_blind;

    signal input shipment_id;

    signal input sku_hash;         // C_S opening
    signal input qty;
    signal input weight_g;
    signal input value_units;
    signal input origin_cell;
    signal input dest_region_root;
    signal input recipient_pk_x;
    signal input recipient_pk_y;
    signal input method;
    signal input deadline_ts;
    signal input shipment_secret;

    signal input cred_class;       // credential leaf
    signal input payload_limit_g;
    signal input expiry_ts;

    signal input cell_id;          // geocell leaf

    signal input cell_rd;          // proof-of-delivery message
    signal input pod_ts;

    signal input lat_q[2];         // two flight waypoints
    signal input lon_q[2];
    signal input alt_dm[2];
    signal input t[2];

    // ── outputs, one per structure ───────────────────────────────────────────
    signal output out_pk_commit;
    signal output out_custody_head;
    signal output out_c_s;
    signal output out_nullifier;
    signal output out_cred_leaf;
    signal output out_cell_leaf;
    signal output out_pod_msg;
    signal output out_flight_d2;

    // 2. pk_commit = P(DOM_PKC, pk_x, pk_y, pk_blind)
    component pkc = Poseidon(4);
    pkc.inputs[0] <== DOM_PKC;
    pkc.inputs[1] <== pk_x;
    pkc.inputs[2] <== pk_y;
    pkc.inputs[3] <== pk_blind;
    out_pk_commit <== pkc.out;

    // 3. custody head = P2(P2(DOM_ACCEPT, shipment_id), pk_commit)
    //    Nested arity-2 (hard rule 7) — mirrors aegis_common::custody_head.
    component headInner = Poseidon(2);
    headInner.inputs[0] <== DOM_ACCEPT;
    headInner.inputs[1] <== shipment_id;
    component headOuter = Poseidon(2);
    headOuter.inputs[0] <== headInner.out;
    headOuter.inputs[1] <== pkc.out;
    out_custody_head <== headOuter.out;

    // 4. C_S = P(DOM_SHIP, ...opening) — single 12-input Poseidon
    component cs = Poseidon(12);
    cs.inputs[0]  <== DOM_SHIP;
    cs.inputs[1]  <== sku_hash;
    cs.inputs[2]  <== qty;
    cs.inputs[3]  <== weight_g;
    cs.inputs[4]  <== value_units;
    cs.inputs[5]  <== origin_cell;
    cs.inputs[6]  <== dest_region_root;
    cs.inputs[7]  <== recipient_pk_x;
    cs.inputs[8]  <== recipient_pk_y;
    cs.inputs[9]  <== method;
    cs.inputs[10] <== deadline_ts;
    cs.inputs[11] <== shipment_secret;
    out_c_s <== cs.out;

    // 5. nullifier = P(DOM_NULL, shipment_secret)
    component nul = Poseidon(2);
    nul.inputs[0] <== DOM_NULL;
    nul.inputs[1] <== shipment_secret;
    out_nullifier <== nul.out;

    // 6. cred_leaf = P(DOM_CRED, pk_x, pk_y, class, payload_limit_g, expiry_ts)
    component cred = Poseidon(6);
    cred.inputs[0] <== DOM_CRED;
    cred.inputs[1] <== pk_x;
    cred.inputs[2] <== pk_y;
    cred.inputs[3] <== cred_class;
    cred.inputs[4] <== payload_limit_g;
    cred.inputs[5] <== expiry_ts;
    out_cred_leaf <== cred.out;

    // 7. cell_leaf = P(DOM_CELL, cell_id)
    component cell = Poseidon(2);
    cell.inputs[0] <== DOM_CELL;
    cell.inputs[1] <== cell_id;
    out_cell_leaf <== cell.out;

    // 8. pod_msg = P(DOM_PODMSG, shipment_id, carrier_pk_commit, cell_rd, ts)
    component pod = Poseidon(5);
    pod.inputs[0] <== DOM_PODMSG;
    pod.inputs[1] <== shipment_id;
    pod.inputs[2] <== pkc.out;
    pod.inputs[3] <== cell_rd;
    pod.inputs[4] <== pod_ts;
    out_pod_msg <== pod.out;

    // 9. flight digest: d0 = P(DOM_FLIGHT, shipment_id);
    //    d_i = P(d_{i-1}, lat_q, lon_q, alt_dm, t_i)
    component d0 = Poseidon(2);
    d0.inputs[0] <== DOM_FLIGHT;
    d0.inputs[1] <== shipment_id;

    component step[2];
    signal digest[3];
    digest[0] <== d0.out;
    for (var i = 0; i < 2; i++) {
        step[i] = Poseidon(5);
        step[i].inputs[0] <== digest[i];
        step[i].inputs[1] <== lat_q[i];
        step[i].inputs[2] <== lon_q[i];
        step[i].inputs[3] <== alt_dm[i];
        step[i].inputs[4] <== t[i];
        digest[i + 1] <== step[i].out;
    }
    out_flight_d2 <== digest[2];
}

component main = Parity();
