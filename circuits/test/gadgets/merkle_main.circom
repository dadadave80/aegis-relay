pragma circom 2.1.6;

// Test harness: MerkleInclusion(3) with the expected root as a public input,
// equated against the computed root.

include "../../lib/merkle_fixed.circom";

template MerkleMain(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal input expectedRoot;

    component m = MerkleInclusion(depth);
    m.leaf <== leaf;
    for (var i = 0; i < depth; i++) {
        m.pathElements[i] <== pathElements[i];
        m.pathIndices[i] <== pathIndices[i];
    }
    m.root === expectedRoot;
}

component main {public [expectedRoot]} = MerkleMain(3);
