pragma circom 2.1.6;

// ---------------------------------------------------------------------------
// safe_cmp.circom — width-checked comparisons (threat T14: field wraparound).
//
// RULE (NORMATIVE, DESIGN §5.3 / §5.5 / hard rule 3): every value is strictly
// bit-decomposed to its declared width BEFORE any comparison or
// multiplication. NEVER use n > 62 for any value that is later multiplied:
// a product of two 62-bit values fits in 124 bits, and a sum of a few such
// products still stays far below the ~254-bit BN254 field modulus, so
// products cannot wrap the field. Wider factors would silently alias mod p
// and break soundness.
// ---------------------------------------------------------------------------

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";

// Constrains `in` to n bits. The Num2Bits constraint system itself is the
// assertion: each bit is boolean-constrained and their weighted sum must
// equal `in`, which is unsatisfiable for any in >= 2^n.
template AssertBits(n) {
    signal input in;
    component bits = Num2Bits(n);
    bits.in <== in;
    // The individual bits are intentionally unused here: they are fully
    // constrained inside Num2Bits (binary + weighted-sum-equals-in), which is
    // the whole assertion. `_ <==` acknowledges this so --inspect stays clean
    // (T15).
    _ <== bits.out;
}

// out = (a < b), with BOTH operands constrained to n bits in this template
// so it is self-contained: callers may not have range-checked a/b, and
// circomlib LessThan(n) is only sound for n-bit inputs.
template LtChecked(n) {
    signal input a;
    signal input b;
    signal output out;

    component ra = AssertBits(n);
    ra.in <== a;
    component rb = AssertBits(n);
    rb.in <== b;

    component lt = LessThan(n);
    lt.in[0] <== a;
    lt.in[1] <== b;
    out <== lt.out;
}

// out = (a <= b), same self-contained range-checking as LtChecked.
template LeqChecked(n) {
    signal input a;
    signal input b;
    signal output out;

    component ra = AssertBits(n);
    ra.in <== a;
    component rb = AssertBits(n);
    rb.in <== b;

    component leq = LessEqThan(n);
    leq.in[0] <== a;
    leq.in[1] <== b;
    out <== leq.out;
}
