pragma circom 2.1.6;

// ---------------------------------------------------------------------------
// log_digest.circom — running Poseidon flight-log digest (DESIGN §9 A2).
//
// d_0 = Poseidon(DOM_FLIGHT, shipment_id)      (binds the log to the shipment
//                                               — threat T7, log reuse)
// d_{i+1} = Poseidon(d_i, lat_q[i], lon_q[i], alt_dm[i], t[i])   for i = 0..N-1
//
// ALL N waypoints are absorbed (d_1 uses waypoint 0). The output is d_N, the
// final digest — the drone signs this (digest-then-sign: one EdDSA verify
// instead of N).
//
// NOTE: this gadget only chains the digest. Range checks (24/16/32-bit
// decompositions), monotonic time, gap and speed bounds are the caller's job
// (flight.circom) via safe_cmp/geocell gadgets.
// ---------------------------------------------------------------------------

include "circomlib/circuits/poseidon.circom";
include "constants.circom";

template FlightDigest(N) {
    signal input shipment_id;
    signal input lat_q[N];
    signal input lon_q[N];
    signal input alt_dm[N];
    signal input t[N];
    signal output digest; // d_N

    component init = Poseidon(2);
    init.inputs[0] <== DOM_FLIGHT();
    init.inputs[1] <== shipment_id;

    signal d[N + 1];
    d[0] <== init.out;

    component step[N];
    for (var i = 0; i < N; i++) {
        step[i] = Poseidon(5);
        step[i].inputs[0] <== d[i];
        step[i].inputs[1] <== lat_q[i];
        step[i].inputs[2] <== lon_q[i];
        step[i].inputs[3] <== alt_dm[i];
        step[i].inputs[4] <== t[i];
        d[i + 1] <== step[i].out;
    }

    digest <== d[N];
}
