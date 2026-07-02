pragma circom 2.1.6;

// ---------------------------------------------------------------------------
// merkle_fixed.circom — fixed-depth Poseidon Merkle inclusion (DESIGN §5.2,
// §5.4; threats T13/T15).
//
// Convention (NORMATIVE — must match contracts/poseidon-merkle/src/merkle.rs
// `root_from_path` and the TS prover): even index = LEFT child. At each
// level, path index bit 0 means the running node is the LEFT Poseidon input
// (sibling right); bit 1 means the sibling is LEFT (node right). Path is
// ordered leaf-level upward; its length fixes the tree depth.
//
// T13: padding leaves (PAD = poseidon2(0,0)) must never be provable members —
// this template constrains leaf != PAD().
// ---------------------------------------------------------------------------

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "constants.circom";

template MerkleInclusion(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root; // caller equates against the expected root

    // T13: the canonical padding leaf is never a member.
    component isPad = IsEqual();
    isPad.in[0] <== leaf;
    isPad.in[1] <== PAD();
    isPad.out === 0;

    signal node[depth + 1];
    node[0] <== leaf;

    signal left[depth];
    signal right[depth];
    component hash[depth];

    for (var i = 0; i < depth; i++) {
        // Each path index bit must be boolean.
        pathIndices[i] * (pathIndices[i] - 1) === 0;

        // Standard mux: bit 0 -> (node, sibling); bit 1 -> (sibling, node).
        left[i]  <== node[i] + pathIndices[i] * (pathElements[i] - node[i]);
        right[i] <== pathElements[i] + pathIndices[i] * (node[i] - pathElements[i]);

        hash[i] = Poseidon(2);
        hash[i].inputs[0] <== left[i];
        hash[i].inputs[1] <== right[i];
        node[i + 1] <== hash[i].out;
    }

    root <== node[depth];
}
