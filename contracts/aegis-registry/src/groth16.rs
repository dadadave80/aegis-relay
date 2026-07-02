//! Parameterized Groth16 verifier over BN254 (CAP-0074 host functions).
//!
//! Transplanted from the v1 donor verifier (`contracts/_staging/groth16_verifier.rs`,
//! itself from `por-verifier`), with the verification key lifted from baked
//! consts into a runtime parameter so one crate can verify multiple circuits
//! (delivery A1 now, flight A2 later). The stored VKs are written once at
//! construction and never mutated (invariant I6).
//!
//! This is a plain in-crate module — no `#[contract]` wrapper, no
//! cross-contract call overhead. `aegis-registry` calls [`verify`] directly.

use soroban_sdk::{
    contracttype,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    vec, Env, Vec,
};

/// Groth16 verification key (uncompressed BN254 points).
///
/// Encoding (see CLAUDE.md gotchas / `prover/src/lib/bn254.ts`):
/// G1 = `BE32(x)‖BE32(y)`; G2 = `BE32(x_c1)‖BE32(x_c0)‖BE32(y_c1)‖BE32(y_c0)`
/// (imaginary limb FIRST — inverse of snarkjs JSON order).
#[derive(Clone)]
#[contracttype]
pub struct VerificationKey {
    pub alpha: Bn254G1Affine,
    pub beta: Bn254G2Affine,
    pub gamma: Bn254G2Affine,
    pub delta: Bn254G2Affine,
    pub ic: Vec<Bn254G1Affine>,
}

/// A Groth16 proof `(A, B, C)`.
#[derive(Clone)]
#[contracttype]
pub struct Proof {
    pub a: Bn254G1Affine,
    pub b: Bn254G2Affine,
    pub c: Bn254G1Affine,
}

/// Verify `proof` against `vk` and `pub_signals`.
///
/// Returns `false` (never panics, never errors) when:
/// - `pub_signals.len() + 1 != vk.ic.len()` — a malformed/mismatched VK can
///   only ever reject, or
/// - the pairing check fails.
///
/// The pairing equation checked is the standard Groth16 relation
/// `e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1`,
/// with `vk_x = IC[0] + Σ signal_i · IC[i+1]` accumulated via the CAP-0074
/// `g1_mul` / `g1_add` host functions.
pub fn verify(env: &Env, vk: &VerificationKey, proof: &Proof, pub_signals: Vec<Bn254Fr>) -> bool {
    if pub_signals.len() + 1 != vk.ic.len() {
        return false;
    }

    let bn = env.crypto().bn254();

    let mut vk_x = vk.ic.get(0).unwrap();
    for (s, v) in pub_signals.iter().zip(vk.ic.iter().skip(1)) {
        let prod = bn.g1_mul(&v, &s);
        vk_x = bn.g1_add(&vk_x, &prod);
    }

    let neg_a = -proof.a.clone();
    let vp1 = vec![env, neg_a, vk.alpha.clone(), vk_x, proof.c.clone()];
    let vp2 = vec![
        env,
        proof.b.clone(),
        vk.beta.clone(),
        vk.gamma.clone(),
        vk.delta.clone(),
    ];

    bn.pairing_check(vp1, vp2)
}
