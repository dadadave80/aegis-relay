use soroban_sdk::{Env, U256, Vec};
use crate::poseidon2;

/// Recomputes a binary Merkle root from a `leaf`, its sibling `path`, and the
/// leaf's `index`, hashing each level with [`poseidon2`].
///
/// Pair ordering is **even index = left child**: at each level, if the current
/// node's index is even it is the *left* input (`poseidon2(node, sibling)`),
/// otherwise it is the *right* input (`poseidon2(sibling, node)`); the index is
/// then shifted right by one bit to move up to the parent. `path` is ordered
/// from the leaf level upward, and its length fixes the tree depth (the number
/// of levels walked).
///
/// # Safety
///
/// This crate performs **no leaf/internal-node domain separation**: a leaf and
/// an internal node holding the same field value hash identically. Callers must
/// guarantee that leaves are commitments which cannot collide with internal
/// nodes — e.g. by making each leaf `poseidon2(value, salt)` and fixing the tree
/// depth — otherwise second-preimage attacks against the tree are possible.
///
/// # Panics
///
/// Does not panic on a wrong `index` or a `path` of the wrong length; it simply
/// returns a root that will not match the expected one. It can only panic
/// transitively through [`poseidon2`].
pub fn root_from_path(env: &Env, leaf: &U256, path: &Vec<U256>, index: u32) -> U256 {
    let mut node = leaf.clone();
    let mut idx = index;
    for sib in path.iter() {
        node = if idx & 1 == 0 { poseidon2(env, &node, &sib) }
               else            { poseidon2(env, &sib, &node) };
        idx >>= 1;
    }
    node
}

/// Returns `true` if `leaf` at position `index` with sibling `path` recomputes
/// to `root`.
///
/// Convenience wrapper over [`root_from_path`]: it recomputes the root using the
/// even-index-is-left-child convention and compares it to `root`. See
/// [`root_from_path`] for the pair-ordering rules and the domain-separation
/// requirement (its `# Safety` note).
///
/// # Panics
///
/// Same as [`root_from_path`]: a wrong `index`/`path` yields `false` rather than
/// panicking.
pub fn verify_inclusion(env: &Env, leaf: &U256, path: &Vec<U256>, index: u32, root: &U256) -> bool {
    &root_from_path(env, leaf, path, index) == root
}

/// Builds the binary Merkle root over `leaves`, hashing pairs bottom-up with
/// [`poseidon2`].
///
/// `leaves` is first padded to the next power of two with the **zero leaf**
/// `poseidon2(0, 0)` (matching the Circom circuit and the off-chain prover — a
/// raw `0` is *not* used), then adjacent pairs are hashed `poseidon2(left,
/// right)` level by level until a single root remains. Pair ordering is even =
/// left, consistent with [`root_from_path`]. An empty `leaves` is padded to a
/// single zero leaf, so the returned root is `poseidon2(0, 0)`.
///
/// See [`root_from_path`]'s `# Safety` note on domain separation.
///
/// # Panics
///
/// Only transitively through [`poseidon2`]; it does not panic on empty or
/// non-power-of-two input.
pub fn build_root(env: &Env, leaves: &Vec<U256>) -> U256 {
    let mut level = pad_pow2(env, leaves);
    while level.len() > 1 {
        let mut next: Vec<U256> = Vec::new(env);
        let mut i = 0;
        while i < level.len() {
            let l = level.get(i).unwrap();
            let r = level.get(i + 1).unwrap();
            next.push_back(poseidon2(env, &l, &r));
            i += 2;
        }
        level = next;
    }
    level.get(0).unwrap()
}

/// Generates the sibling `path` for the leaf at `index` in the Merkle tree over
/// `leaves`.
///
/// `leaves` is padded to the next power of two with the zero leaf
/// `poseidon2(0, 0)` (see [`build_root`]), then the sibling at each level is
/// collected from the leaf level upward. The returned path is consumed by
/// [`root_from_path`]/[`verify_inclusion`] with the same `index` and the even =
/// left convention.
///
/// # Panics
///
/// Panics (via the internal sibling lookup) if `index` is out of range for the
/// padded tree, i.e. `index >= leaves.len()` rounded up to the next power of
/// two.
pub fn gen_path(env: &Env, leaves: &Vec<U256>, index: u32) -> Vec<U256> {
    let mut level = pad_pow2(env, leaves);
    let mut idx = index;
    let mut path: Vec<U256> = Vec::new(env);
    while level.len() > 1 {
        let sib = if idx & 1 == 0 { idx + 1 } else { idx - 1 };
        path.push_back(level.get(sib).unwrap());
        let mut next: Vec<U256> = Vec::new(env);
        let mut i = 0;
        while i < level.len() {
            let l = level.get(i).unwrap();
            let r = level.get(i + 1).unwrap();
            next.push_back(poseidon2(env, &l, &r));
            i += 2;
        }
        level = next;
        idx >>= 1;
    }
    path
}

// Pads `leaves` up to the next power of two with the ZERO LEAF `poseidon2(0, 0)`
// (NOT a raw `0`), matching the padding convention used by the Circom circuit
// and the off-chain prover so that on-chain roots agree with generated proofs.
// The zero leaf is computed once and reused for every padding slot.
fn pad_pow2(env: &Env, leaves: &Vec<U256>) -> Vec<U256> {
    let mut out = leaves.clone();
    let mut n = 1u32;
    while n < out.len() { n <<= 1; }
    let zero = U256::from_u32(env, 0);
    let zero_leaf = poseidon2(env, &zero, &zero);
    while out.len() < n { out.push_back(zero_leaf.clone()); }
    out
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{vec, Env, U256};

    fn u(env: &Env, n: u32) -> U256 { U256::from_u32(env, n) }

    #[test]
    fn root_and_inclusion_roundtrip() {
        let env = Env::default();
        let leaves = vec![&env, u(&env,10), u(&env,20), u(&env,30), u(&env,40)];
        let root = build_root(&env, &leaves);
        for i in 0..4u32 {
            let path = gen_path(&env, &leaves, i);
            let leaf = leaves.get(i).unwrap();
            assert!(verify_inclusion(&env, &leaf, &path, i, &root), "leaf {i} should verify");
        }
    }

    #[test]
    fn non_pow2_padding_roundtrip() {
        // 3 leaves is not a power of two, so build_root/gen_path exercise the
        // zero-leaf padding path (padded up to 4 with poseidon2(0, 0)).
        let env = Env::default();
        let leaves = vec![&env, u(&env, 10), u(&env, 20), u(&env, 30)];
        let root = build_root(&env, &leaves);
        for i in 0..3u32 {
            let path = gen_path(&env, &leaves, i);
            let leaf = leaves.get(i).unwrap();
            assert!(verify_inclusion(&env, &leaf, &path, i, &root), "leaf {i} should verify");
        }
    }

    #[test]
    fn tampered_leaf_fails() {
        let env = Env::default();
        let leaves = vec![&env, u(&env,10), u(&env,20), u(&env,30), u(&env,40)];
        let root = build_root(&env, &leaves);
        let path = gen_path(&env, &leaves, 1);
        assert!(!verify_inclusion(&env, &u(&env,999), &path, 1, &root));
    }
}
