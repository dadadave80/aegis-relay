pragma circom 2.1.6;

// ---------------------------------------------------------------------------
// delivery.circom — A1: proof of delivery (DESIGN.md §8.4, §9 A1).
//
// Statement: "The recipient committed in C_S signed a fresh PoD message bound
// to the current custodian (head) and to a location inside the committed
// destination region; the nullifier is correctly derived."
//
// Public inputs, in EXACTLY this declaration order (this order IS the
// contract's pub_signals order — pinned by circuits/fixtures/delivery/meta.json
// and contracts/aegis-registry/src/test_fixtures.rs):
//
//   [shipment_id, c_s, head, nullifier, ts]
//
// No output signals. All six constraint groups from DESIGN §9 A1:
//   (1) C_S opening        (2) head opening (nested arity-2, §6.2)
//   (3) dest-region membership (T13: leaf != PAD inside MerkleInclusion)
//   (4) recipient EdDSA-Poseidon over the PoD message (T8)
//   (5) nullifier derivation (§6.4)
//   (6) defensive width pins (T14) on everything the contract may reason about
// ---------------------------------------------------------------------------

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/eddsaposeidon.circom";
include "lib/constants.circom";
include "lib/safe_cmp.circom";
include "lib/merkle_fixed.circom";
include "lib/geocell.circom";

template Delivery() {
    // ── Public inputs (declaration order = pub_signals order — DO NOT REORDER) ──
    signal input shipment_id;
    signal input c_s;
    signal input head;
    signal input nullifier;
    signal input ts;

    // ── Private witness ─────────────────────────────────────────────────────
    // C_S opening (DESIGN §6.1, 11 fields + DOM_SHIP tag)
    signal input sku_hash;
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
    // carrier_pk_commit opening (DESIGN §6.2)
    signal input pk_x;
    signal input pk_y;
    signal input pk_blind;
    // recipient EdDSA-Poseidon signature over the PoD message m
    signal input sig_R8x;
    signal input sig_R8y;
    signal input sig_S;
    // PoD location + depth-6 membership path into dest_region_root
    signal input lat_q;
    signal input lon_q;
    signal input dest_path[DEST_DEPTH()];
    signal input dest_path_index[DEST_DEPTH()];

    // ── (6) Width pins (T14) — strict bit decomposition before anything else.
    // ts is contract-checked against ledger time; the rest pin the C_S opening
    // to its declared §5.3 widths so no field-wrapped value can hide inside
    // the commitment.
    component tsBits = AssertBits(32);
    tsBits.in <== ts;
    component qtyBits = AssertBits(32);
    qtyBits.in <== qty;
    component weightBits = AssertBits(32);
    weightBits.in <== weight_g;
    component valueBits = AssertBits(64);
    valueBits.in <== value_units;
    component deadlineBits = AssertBits(32);
    deadlineBits.in <== deadline_ts;

    // ── (1) C_S = Poseidon(DOM_SHIP, ...opening) — single 12-input Poseidon ──
    component csHash = Poseidon(12);
    csHash.inputs[0]  <== DOM_SHIP();
    csHash.inputs[1]  <== sku_hash;
    csHash.inputs[2]  <== qty;
    csHash.inputs[3]  <== weight_g;
    csHash.inputs[4]  <== value_units;
    csHash.inputs[5]  <== origin_cell;
    csHash.inputs[6]  <== dest_region_root;
    csHash.inputs[7]  <== recipient_pk_x;
    csHash.inputs[8]  <== recipient_pk_y;
    csHash.inputs[9]  <== method;
    csHash.inputs[10] <== deadline_ts;
    csHash.inputs[11] <== shipment_secret;
    c_s === csHash.out;

    // ── (2) head = P2(P2(DOM_ACCEPT, shipment_id), carrier_pk_commit) ──
    // Nested arity-2 (hard rule 7); carrier_pk_commit opened as witness so the
    // prover is bound to the current custodian (T8).
    component pkc = Poseidon(4);
    pkc.inputs[0] <== DOM_PKC();
    pkc.inputs[1] <== pk_x;
    pkc.inputs[2] <== pk_y;
    pkc.inputs[3] <== pk_blind;

    component headInner = Poseidon(2);
    headInner.inputs[0] <== DOM_ACCEPT();
    headInner.inputs[1] <== shipment_id;
    component headOuter = Poseidon(2);
    headOuter.inputs[0] <== headInner.out;
    headOuter.inputs[1] <== pkc.out;
    head === headOuter.out;

    // ── (3) PoD location inside the committed destination region ──
    // cell_rd (raw RD-resolution Morton cell) feeds the PoD message; its leaf
    // Poseidon(DOM_CELL, cell_rd) must be a member of dest_region_root.
    // MerkleInclusion constrains leaf != PAD (T13) and boolean path bits.
    component cellRd = Cell(RD_RES());
    cellRd.lat_q <== lat_q;
    cellRd.lon_q <== lon_q;

    component cellLeaf = CellLeaf(RD_RES());
    cellLeaf.lat_q <== lat_q;
    cellLeaf.lon_q <== lon_q;

    component incl = MerkleInclusion(DEST_DEPTH());
    incl.leaf <== cellLeaf.leaf;
    for (var i = 0; i < DEST_DEPTH(); i++) {
        incl.pathElements[i] <== dest_path[i];
        incl.pathIndices[i] <== dest_path_index[i];
    }
    incl.root === dest_region_root;

    // ── (4) m = P(DOM_PODMSG, shipment_id, carrier_pk_commit, cell_rd, ts);
    // recipient (from the C_S opening) must have EdDSA-Poseidon-signed m.
    // Binding pkc.out makes a stolen/pre-collected signature useless to any
    // other custodian; binding cell_rd ties it to the place; ts to the window.
    component podMsg = Poseidon(5);
    podMsg.inputs[0] <== DOM_PODMSG();
    podMsg.inputs[1] <== shipment_id;
    podMsg.inputs[2] <== pkc.out;
    podMsg.inputs[3] <== cellRd.cell;
    podMsg.inputs[4] <== ts;

    component sig = EdDSAPoseidonVerifier();
    sig.enabled <== 1;
    sig.Ax  <== recipient_pk_x;
    sig.Ay  <== recipient_pk_y;
    sig.S   <== sig_S;
    sig.R8x <== sig_R8x;
    sig.R8y <== sig_R8y;
    sig.M   <== podMsg.out;

    // ── (5) nullifier = P(DOM_NULL, shipment_secret) ──
    component nullHash = Poseidon(2);
    nullHash.inputs[0] <== DOM_NULL();
    nullHash.inputs[1] <== shipment_secret;
    nullifier === nullHash.out;
}

component main {public [shipment_id, c_s, head, nullifier, ts]} = Delivery();
