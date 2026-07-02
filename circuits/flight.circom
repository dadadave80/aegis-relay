pragma circom 2.1.6;

// ---------------------------------------------------------------------------
// flight.circom — A2: drone route compliance (DESIGN.md §5.4, §5.5, §8.3, §9 A2).
//
// Statement: "An N=16-waypoint telemetry log, digest-signed by the drone key
// that is this shipment's custodian, lies entirely within corridor_root, is
// time-monotonic and gap-free, respects ALT_MAX and the conservative speed
// bound (§5.5), starts at the committed origin cell and ends inside the
// committed destination region, and the committed payload weight is within
// the method limit."
//
// Public inputs, in EXACTLY this declaration order (this order IS the
// contract's pub_signals order — pinned by circuits/fixtures/flight/meta.json
// and contracts/aegis-registry/src/test_fixtures_flight.rs):
//
//   [shipment_id, c_s, head, corridor_root, t_0, t_n]
//
// No output signals. Constraint groups (DESIGN §9 A2, in order):
//   (1)  C_S opening (single 12-input Poseidon, field order as delivery.circom)
//   (2)  head opening (nested arity-2, §6.2 — the DRONE key IS the custody key)
//   (3)  method == METHOD_DRONE
//   (4)  d_N = FlightDigest(N); ONE EdDSA-Poseidon verify over d_N
//        (digest-then-sign; d_0 absorbs shipment_id — T7 splice binding)
//   (5)  per waypoint: cell_RC ∈ corridor_root (leaf != PAD, T13),
//        alt_dm ≤ ALT_MAX (16-bit pinned), t 32-bit pinned
//   (6)  per pair: strict monotonic t, gap ≤ GAP_MAX (8-bit pinned dt)
//   (7)  per pair: speed bound §5.5 — dlat² + 4·dlon² ≤ (VMAX_U·dt)²
//        (raw field differences; squaring fixes sign because both operands
//        are 24-bit-constrained: |d| < 2^24 ⇒ d² < 2^48, no field wrap; T14)
//   (8)  cell_RC(w_0) == origin_cell
//   (9)  cell_RD(w_{N-1}) ∈ dest_region_root
//   (10) weight_g ≤ DRONE_MAX_G (32-bit pinned)
//   (11) t_0 == t[0]; t_n == t[N-1]
// ---------------------------------------------------------------------------

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/eddsaposeidon.circom";
include "lib/constants.circom";
include "lib/safe_cmp.circom";
include "lib/merkle_fixed.circom";
include "lib/geocell.circom";
include "lib/log_digest.circom";

template Flight(N) {
    // ── Public inputs (declaration order = pub_signals order — DO NOT REORDER) ──
    signal input shipment_id;
    signal input c_s;
    signal input head;
    signal input corridor_root;
    signal input t_0;
    signal input t_n;

    // ── Private witness ─────────────────────────────────────────────────────
    // C_S opening (DESIGN §6.1, 11 fields + DOM_SHIP tag — same order as A1)
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
    // carrier_pk_commit opening (DESIGN §6.2) — the DRONE key IS the custody key
    signal input pk_x;
    signal input pk_y;
    signal input pk_blind;
    // drone EdDSA-Poseidon signature over the final digest d_N
    signal input sig_R8x;
    signal input sig_R8y;
    signal input sig_S;
    // telemetry log: N waypoints
    signal input lat_q[N];
    signal input lon_q[N];
    signal input alt_dm[N];
    signal input t[N];
    // per-waypoint depth-12 membership paths into corridor_root
    signal input corridor_path[N][CORRIDOR_DEPTH()];
    signal input corridor_index[N][CORRIDOR_DEPTH()];
    // final-waypoint depth-6 membership path into dest_region_root
    signal input dest_path[DEST_DEPTH()];
    signal input dest_index[DEST_DEPTH()];

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
    // Nested arity-2 (hard rule 7); opening carrier_pk_commit as witness binds
    // the prover to the current custodian — the drone's own key (T6/T8).
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

    // ── (3) this proof only makes sense for drone shipments ──
    method === METHOD_DRONE();

    // ── (4) d_N = FlightDigest(N); ONE EdDSA verify over the digest ──
    // d_0 = P(DOM_FLIGHT, shipment_id) inside FlightDigest binds the whole log
    // to this shipment (T7: an honest log for shipment A cannot be spliced
    // into shipment B — d_N changes, the signature dies).
    component digest = FlightDigest(N);
    digest.shipment_id <== shipment_id;
    for (var i = 0; i < N; i++) {
        digest.lat_q[i]  <== lat_q[i];
        digest.lon_q[i]  <== lon_q[i];
        digest.alt_dm[i] <== alt_dm[i];
        digest.t[i]      <== t[i];
    }

    component sig = EdDSAPoseidonVerifier();
    sig.enabled <== 1;
    sig.Ax  <== pk_x;
    sig.Ay  <== pk_y;
    sig.S   <== sig_S;
    sig.R8x <== sig_R8x;
    sig.R8y <== sig_R8y;
    sig.M   <== digest.digest;

    // ── (5) per waypoint: corridor membership + altitude + time widths ──
    // Cell(RC_RES) strictly decomposes lat_q/lon_q to 24 bits (T14) — this is
    // also what makes the raw differences in (7) safe to square.
    component cellRc[N];
    component leafRc[N];
    component inCorridor[N];
    component altBits[N];
    component altMax[N];
    component tBits[N];
    for (var i = 0; i < N; i++) {
        cellRc[i] = Cell(RC_RES());
        cellRc[i].lat_q <== lat_q[i];
        cellRc[i].lon_q <== lon_q[i];

        leafRc[i] = CellLeaf(RC_RES());
        leafRc[i].lat_q <== lat_q[i];
        leafRc[i].lon_q <== lon_q[i];

        inCorridor[i] = MerkleInclusion(CORRIDOR_DEPTH());
        inCorridor[i].leaf <== leafRc[i].leaf;
        for (var j = 0; j < CORRIDOR_DEPTH(); j++) {
            inCorridor[i].pathElements[j] <== corridor_path[i][j];
            inCorridor[i].pathIndices[j]  <== corridor_index[i][j];
        }
        inCorridor[i].root === corridor_root;

        altBits[i] = AssertBits(16);
        altBits[i].in <== alt_dm[i];
        altMax[i] = LeqChecked(16);
        altMax[i].a <== alt_dm[i];
        altMax[i].b <== ALT_MAX_DM();
        altMax[i].out === 1;

        tBits[i] = AssertBits(32);
        tBits[i].in <== t[i];
    }

    // ── (6) per consecutive pair: strict monotonic time + bounded gap ──
    // ── (7) per consecutive pair: SPEED BOUND §5.5 ──
    // dlat/dlon are RAW field differences — a "negative" difference wraps to a
    // huge field element, but squaring fixes the sign: both operands are
    // 24-bit-constrained (Cell above), so |d| < 2^24 and d² < 2^48 exactly
    // (no field wrap; (-x)² ≡ x² mod p). lhs < 2^48 + 4·2^48 < 2^51; rhs =
    // (VMAX_U·dt)² ≤ (20·30)² = 360000. LeqChecked(51) re-pins both to 51 bits.
    component mono[N - 1];
    component dtBits[N - 1];
    component gapMax[N - 1];
    component speed[N - 1];
    signal dt[N - 1];
    signal dlat[N - 1];
    signal dlon[N - 1];
    signal dlat2[N - 1];
    signal dlon2[N - 1];
    signal lhs[N - 1];
    signal vdt[N - 1];
    signal rhs[N - 1];
    for (var i = 1; i < N; i++) {
        // strict monotonic: t[i-1] < t[i] (both re-pinned to 32 bits inside)
        mono[i - 1] = LtChecked(32);
        mono[i - 1].a <== t[i - 1];
        mono[i - 1].b <== t[i];
        mono[i - 1].out === 1;

        // gap: dt = t[i] - t[i-1] ≤ GAP_MAX_SEC (8-bit pin suffices given Leq)
        dt[i - 1] <== t[i] - t[i - 1];
        dtBits[i - 1] = AssertBits(8);
        dtBits[i - 1].in <== dt[i - 1];
        gapMax[i - 1] = LeqChecked(8);
        gapMax[i - 1].a <== dt[i - 1];
        gapMax[i - 1].b <== GAP_MAX_SEC();
        gapMax[i - 1].out === 1;

        // speed: dlat² + 4·dlon² ≤ (VMAX_U·dt)²  (§5.5 — lon weighted 2× so
        // computed distance ≥ true distance at every latitude; conservative
        // in the sound direction, can never under-measure a teleport)
        dlat[i - 1] <== lat_q[i] - lat_q[i - 1];
        dlon[i - 1] <== lon_q[i] - lon_q[i - 1];
        dlat2[i - 1] <== dlat[i - 1] * dlat[i - 1];
        dlon2[i - 1] <== dlon[i - 1] * dlon[i - 1];
        lhs[i - 1] <== dlat2[i - 1] + 4 * dlon2[i - 1];
        vdt[i - 1] <== VMAX_U() * dt[i - 1];
        rhs[i - 1] <== vdt[i - 1] * vdt[i - 1];
        speed[i - 1] = LeqChecked(51);
        speed[i - 1].a <== lhs[i - 1];
        speed[i - 1].b <== rhs[i - 1];
        speed[i - 1].out === 1;
    }

    // ── (8) flight starts at the committed origin cell ──
    cellRc[0].cell === origin_cell;
    // cellRc[i>0].cell values are not otherwise consumed (membership goes via
    // CellLeaf); they remain fully constrained inside Cell. `_ <==`
    // acknowledges this so --inspect stays clean (T15).
    for (var i = 1; i < N; i++) {
        _ <== cellRc[i].cell;
    }

    // ── (9) flight ends inside the committed destination region ──
    component cellRd = Cell(RD_RES());
    cellRd.lat_q <== lat_q[N - 1];
    cellRd.lon_q <== lon_q[N - 1];
    _ <== cellRd.cell; // membership goes via CellLeaf; Cell pins the widths

    component leafRd = CellLeaf(RD_RES());
    leafRd.lat_q <== lat_q[N - 1];
    leafRd.lon_q <== lon_q[N - 1];

    component inDest = MerkleInclusion(DEST_DEPTH());
    inDest.leaf <== leafRd.leaf;
    for (var j = 0; j < DEST_DEPTH(); j++) {
        inDest.pathElements[j] <== dest_path[j];
        inDest.pathIndices[j]  <== dest_index[j];
    }
    inDest.root === dest_region_root;

    // ── (10) committed payload weight within the drone method limit ──
    component weightBits = AssertBits(32);
    weightBits.in <== weight_g;
    component weightMax = LeqChecked(32);
    weightMax.a <== weight_g;
    weightMax.b <== DRONE_MAX_G();
    weightMax.out === 1;

    // ── (11) exported flight window (contract checks t_0 ≥ accept_ts and
    // t_n freshness against ledger time — I9/T7) ──
    t_0 === t[0];
    t_n === t[N - 1];
}

component main {public [shipment_id, c_s, head, corridor_root, t_0, t_n]} = Flight(16);
