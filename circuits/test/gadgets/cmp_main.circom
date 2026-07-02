pragma circom 2.1.6;

// Test harness: LtChecked(32) and LeqChecked(32) side by side (T14 probe).

include "../../lib/safe_cmp.circom";

template CmpMain() {
    signal input a;
    signal input b;
    signal output lt_out;
    signal output leq_out;

    component lt = LtChecked(32);
    lt.a <== a;
    lt.b <== b;
    lt_out <== lt.out;

    component leq = LeqChecked(32);
    leq.a <== a;
    leq.b <== b;
    leq_out <== leq.out;
}

component main = CmpMain();
