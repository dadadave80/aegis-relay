pragma circom 2.1.6;

// Test harness: FlightDigest(3) — running Poseidon flight-log digest.

include "../../lib/log_digest.circom";

template DigestMain(N) {
    signal input shipment_id;
    signal input lat_q[N];
    signal input lon_q[N];
    signal input alt_dm[N];
    signal input t[N];
    signal output digest;

    component fd = FlightDigest(N);
    fd.shipment_id <== shipment_id;
    for (var i = 0; i < N; i++) {
        fd.lat_q[i] <== lat_q[i];
        fd.lon_q[i] <== lon_q[i];
        fd.alt_dm[i] <== alt_dm[i];
        fd.t[i] <== t[i];
    }
    digest <== fd.digest;
}

component main = DigestMain(3);
