#![no_std]
//! aegis-common — normative protocol constants and on-chain hash structures
//! shared by every Aegis contract (DESIGN.md §5/§6).
//!
//! These constants MUST stay identical to `prover/src/lib/constants.ts` (TS)
//! and the values pinned in `fixtures/parity.json`. The parity tests here,
//! in the prover, and in `circuits/test/parity.test.mjs` enforce the
//! lockstep — never edit one side alone.
//!
//! Note on arity: the transplanted `poseidon-merkle` crate ships only the
//! t = 3 Poseidon constants, so the chain can compute **arity-2 hashes only**.
//! Wider structures (`pk_commit` is 4-ary, `C_S` is 12-ary, …) are
//! deliberately NOT implemented here — they exist off-chain (prover) and
//! in-circuit; on-chain code only ever consumes them as opaque field
//! elements. The custody head is the one on-chain-computed structure, and it
//! is nested arity-2 for exactly this reason.

use soroban_sdk::{Env, U256};

// ── Domain-separation tags (DESIGN.md §5.2) ─────────────────────────────────
// Every Poseidon call takes a distinct leading tag; a hash without a tag is a
// spec violation. Never reuse tags.

/// Shipment commitment `C_S`.
pub const DOM_SHIP: u64 = 1;
/// Custody head, genesis (single-carrier).
pub const DOM_ACCEPT: u64 = 2;
/// Custody head, advance (A4, stretch).
pub const DOM_HANDOFF: u64 = 3;
/// Handoff message signed by both parties.
pub const DOM_HANDMSG: u64 = 4;
/// Proof-of-delivery message signed by recipient.
pub const DOM_PODMSG: u64 = 5;
/// Delivery nullifier.
pub const DOM_NULL: u64 = 6;
/// Carrier public-key commitment.
pub const DOM_PKC: u64 = 7;
/// Credential tree leaf.
pub const DOM_CRED: u64 = 8;
/// Geocell tree leaf (corridor + dest region).
pub const DOM_CELL: u64 = 9;
/// Flight-log running digest init.
pub const DOM_FLIGHT: u64 = 10;
/// Condition-log running digest init (stretch).
pub const DOM_COND: u64 = 11;
/// Canonical padding tag (reserved, unused — PAD is `poseidon2(0, 0)`).
pub const DOM_EMPTY: u64 = 12;

// ── Protocol parameters (DESIGN.md §5.3–§5.5, §6) ───────────────────────────

/// Flight window length, seconds.
pub const WINDOW_SEC: u64 = 600;
/// Max gap between consecutive waypoints, seconds.
pub const GAP_MAX_SEC: u64 = 30;
/// Max altitude, decimeters AGL.
pub const ALT_MAX_DM: u64 = 1200;
/// Max speed, meters per second.
pub const VMAX_MPS: u64 = 25;
/// `floor(VMAX_MPS / 1.194)` — max speed in lat_q units per second.
pub const VMAX_U: u64 = 20;
/// Corridor-cell Morton resolution.
pub const RC_RES: u32 = 15;
/// Destination-region-cell Morton resolution.
pub const RD_RES: u32 = 17;
/// Corridor tree depth (≤ 4096 RC cells).
pub const CORRIDOR_DEPTH: u32 = 12;
/// Destination region tree depth (≤ 64 RD cells).
pub const DEST_DEPTH: u32 = 6;
/// Issuer credential tree depth.
pub const CRED_DEPTH: u32 = 10;
/// Drone payload hard cap, grams.
pub const DRONE_MAX_G: u64 = 5000;
/// Delivery method: ground courier.
pub const METHOD_COURIER: u64 = 1;
/// Delivery method: locker.
pub const METHOD_LOCKER: u64 = 2;
/// Delivery method: drone.
pub const METHOD_DRONE: u64 = 3;

// ── Field helpers ───────────────────────────────────────────────────────────

/// Lifts a `u64` into a BN254 Fr element represented as [`U256`].
///
/// Every u64 is trivially `< r`, so no reduction is needed.
pub fn fr_u64(env: &Env, v: u64) -> U256 {
    U256::from_u128(env, v as u128)
}

/// `PAD = poseidon2(0, 0)` — the canonical zero leaf for every fixed-depth
/// Merkle tree (identical in Rust, circom, and TS).
///
/// Computed live via the CAP-0075-parity `poseidon2` (never hardcoded here);
/// the unit test pins it against the fixture decimal.
pub fn pad(env: &Env) -> U256 {
    let zero = U256::from_u32(env, 0);
    poseidon_merkle::poseidon2(env, &zero, &zero)
}

/// Custody head, genesis form (DESIGN.md §6.2, hard rule 7):
///
/// ```text
/// head = poseidon2(poseidon2(DOM_ACCEPT, shipment_id), carrier_pk_commit)
/// ```
///
/// Nested arity-2 — NOT one arity-3 hash — because the transplanted crate
/// ships only the t = 3 Poseidon constants. The circuits and the TS prover
/// (`custodyHead` in `prover/src/lib/poseidon.ts`) mirror this nesting
/// exactly.
pub fn custody_head(env: &Env, shipment_id: u64, carrier_pk_commit: &U256) -> U256 {
    let inner = poseidon_merkle::poseidon2(
        env,
        &fr_u64(env, DOM_ACCEPT),
        &fr_u64(env, shipment_id),
    );
    poseidon_merkle::poseidon2(env, &inner, carrier_pk_commit)
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{vec, Env, U256};

    // Pinned from fixtures/parity.json — regenerate with
    // prover/scripts/gen-parity.mjs.
    const PAD_DEC: &str =
        "14744269619966411208579211824598458697587494354926760081771325075741142829156";
    // structures.custody_head: shipment_id = 42, carrier_pk_commit below.
    const CARRIER_PK_COMMIT_DEC: &str =
        "15455931307768948041595817576412392366190915015111339244245604316125360041285";
    const CUSTODY_HEAD_DEC: &str =
        "8958980627937328883922135372698730990779057792140558926763676767422753973914";
    // structures.merkle4_root: leaves L0, L1, L2 (L3 = PAD via padding).
    const MERKLE4_L0_DEC: &str =
        "20074349305227277918475287034427154928659258937382099399583594146114403092565";
    const MERKLE4_L1_DEC: &str =
        "7778997134051138587408427739484079414447244783521982170172236468501887159810";
    const MERKLE4_L2_DEC: &str =
        "11541398639474698621325033725926796776118603757169531876459984064123351510492";
    const MERKLE4_ROOT_DEC: &str =
        "9019419532646637226663962410998343527713084354863483553660548588924134733546";

    fn u256_from_dec(env: &Env, dec: &str) -> U256 {
        // helper: parse decimal into U256 via repeated *10 + digit
        let mut acc = U256::from_u32(env, 0);
        let ten = U256::from_u32(env, 10);
        for ch in dec.bytes() {
            let d = (ch - b'0') as u32;
            acc = acc.mul(&ten).add(&U256::from_u32(env, d));
        }
        acc
    }

    #[test]
    fn pad_matches_pinned_fixture() {
        let env = Env::default();
        assert_eq!(pad(&env), u256_from_dec(&env, PAD_DEC));
    }

    #[test]
    fn custody_head_matches_pinned_fixture() {
        let env = Env::default();
        let pk_commit = u256_from_dec(&env, CARRIER_PK_COMMIT_DEC);
        let head = custody_head(&env, 42, &pk_commit);
        assert_eq!(head, u256_from_dec(&env, CUSTODY_HEAD_DEC));
    }

    #[test]
    fn custody_head_differs_per_shipment_and_carrier() {
        // Guards the nesting: a tag/nesting mistake tends to collapse
        // distinct inputs onto the same digest.
        let env = Env::default();
        let pk_commit = u256_from_dec(&env, CARRIER_PK_COMMIT_DEC);
        let head = custody_head(&env, 42, &pk_commit);
        assert_ne!(head, custody_head(&env, 43, &pk_commit));
        let other_commit = U256::from_u32(&env, 1);
        assert_ne!(head, custody_head(&env, 42, &other_commit));
    }

    #[test]
    fn merkle4_root_matches_pinned_fixture() {
        // Cross-checks the tree convention (pairwise poseidon2, even index =
        // left child, PAD fill) among poseidon_merkle::build_root, the TS
        // tree builder, and the fixture: 3 leaves are padded to 4 with PAD.
        let env = Env::default();
        let leaves = vec![
            &env,
            u256_from_dec(&env, MERKLE4_L0_DEC),
            u256_from_dec(&env, MERKLE4_L1_DEC),
            u256_from_dec(&env, MERKLE4_L2_DEC),
        ];
        let root = poseidon_merkle::build_root(&env, &leaves);
        assert_eq!(root, u256_from_dec(&env, MERKLE4_ROOT_DEC));
    }

    #[test]
    fn fr_u64_round_trips_extremes() {
        let env = Env::default();
        assert_eq!(fr_u64(&env, 0), U256::from_u32(&env, 0));
        assert_eq!(fr_u64(&env, u64::MAX), U256::from_u128(&env, u64::MAX as u128));
    }
}
