#![cfg(test)]

//! Registry tests. Pinned scenario numbers (MUST match the fixture generated
//! by `prover/scripts/gen-delivery-fixtures.mjs`):
//!   shipment_id = 1 (first create), PoD ts = 1_800_000_000,
//!   accept at ledger ts 1_799_999_990, deliver at ledger ts 1_800_000_060,
//!   escrow_deadline = 1_800_086_400, amount = 1_000_000_000 (100 XLM in
//!   stroops), milestones = [10_000], method = Courier.
//!
//! until `test_fixtures.rs` is regenerated with real bytes; they must compile
//! regardless.

use soroban_sdk::{
    crypto::bn254::{
        Bn254Fr, Bn254G1Affine, Bn254G2Affine, BN254_G1_SERIALIZED_SIZE, BN254_G2_SERIALIZED_SIZE,
    },
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, U256, Vec,
};

use crate::{
    groth16, test_fixtures, test_fixtures_flight, DataKey, Error, Method, Rail, RegistryContract,
    RegistryContractClient, State,
};

// ── Pinned scenario numbers ───────────────────────────────────────────────────

const AMOUNT: i128 = 1_000_000_000; // 100 XLM in stroops
const ESCROW_DEADLINE: u64 = 1_800_086_400;
const ACCEPT_LEDGER_TS: u64 = 1_799_999_990;
const POD_TS: u64 = 1_800_000_000;
const DELIVER_LEDGER_TS: u64 = 1_800_000_060;

// ── Pinned flight-scenario numbers (MUST match test_fixtures_flight) ───────────
const FLIGHT_LANE: u32 = 7;
const FLIGHT_T0: u64 = 1_800_000_000;
const FLIGHT_TN: u64 = 1_800_000_300;
const SUBMIT_FLIGHT_LEDGER: u64 = 1_800_000_350;
const DRONE_DELIVER_LEDGER: u64 = 1_800_000_420;
// Corridor window that comfortably brackets the flight scenario.
const CORRIDOR_FROM: u64 = 1_799_000_000;
const CORRIDOR_TO: u64 = 1_801_000_000;

// ── Synthetic VK (TEST ONLY) ─────────────────────────────────────────────────
// Byte arrays copied from the deleted `contracts/_staging/groth16_verifier.rs`
// (the v1 por-verifier VK). Used only to construct the contract in tests that
// never verify a real proof, and for the signal-length unit test.

const SYN_VK_ALPHA: [u8; BN254_G1_SERIALIZED_SIZE] = [0x14, 0x67, 0xa5, 0xfc, 0x15, 0x68, 0x48, 0x50, 0x3e, 0x7d, 0x6e, 0x95, 0x28, 0x03, 0x9e, 0xc2, 0x58, 0x38, 0xe7, 0xbf, 0xcf, 0xdb, 0xf0, 0x97, 0x3b, 0xad, 0x02, 0x38, 0xa6, 0x5e, 0xe0, 0x59, 0x1d, 0x4f, 0x5c, 0x95, 0x41, 0x5b, 0x2a, 0x10, 0x24, 0xc0, 0x76, 0xe9, 0x58, 0xfd, 0x07, 0x9d, 0xac, 0x06, 0xc1, 0x93, 0x4b, 0x70, 0x15, 0xac, 0x2b, 0x75, 0xb3, 0xee, 0x23, 0x9c, 0x84, 0x07];
const SYN_VK_BETA: [u8; BN254_G2_SERIALIZED_SIZE] = [0x05, 0x7d, 0xf2, 0x6c, 0xae, 0x9a, 0x86, 0x7d, 0x15, 0x1b, 0xa2, 0x6b, 0x2d, 0x37, 0xa3, 0x9c, 0xb1, 0x65, 0x2b, 0x8f, 0x6f, 0x9d, 0x09, 0x0e, 0x52, 0xab, 0x22, 0x75, 0xa7, 0x4a, 0xfc, 0xed, 0x05, 0x69, 0x5a, 0x12, 0xc8, 0x8f, 0xd8, 0x98, 0x77, 0x92, 0x9a, 0xc1, 0x33, 0x82, 0x70, 0x64, 0x5b, 0xc5, 0xbb, 0xfd, 0xb6, 0x5e, 0xbf, 0x95, 0x44, 0x98, 0xa6, 0xe5, 0xac, 0x51, 0x2e, 0x39, 0x2d, 0x3d, 0x7f, 0x5a, 0x04, 0xde, 0x31, 0x47, 0x4e, 0xd9, 0x16, 0x7b, 0x33, 0x80, 0xd0, 0x7c, 0x18, 0xf4, 0x8b, 0x07, 0xa5, 0x8d, 0xc7, 0x7b, 0x2c, 0x73, 0xec, 0xc1, 0xda, 0x37, 0x3f, 0xea, 0x05, 0x74, 0x46, 0x0d, 0x40, 0x2e, 0xdc, 0x5f, 0xaf, 0xde, 0xc9, 0x4f, 0xdd, 0x78, 0x71, 0x53, 0xe5, 0xa4, 0x8b, 0xdc, 0x3e, 0x3a, 0xd1, 0xfc, 0x26, 0x47, 0xf9, 0x2b, 0xa1, 0x30, 0x31, 0xeb];
const SYN_VK_GAMMA: [u8; BN254_G2_SERIALIZED_SIZE] = [0x19, 0x8e, 0x93, 0x93, 0x92, 0x0d, 0x48, 0x3a, 0x72, 0x60, 0xbf, 0xb7, 0x31, 0xfb, 0x5d, 0x25, 0xf1, 0xaa, 0x49, 0x33, 0x35, 0xa9, 0xe7, 0x12, 0x97, 0xe4, 0x85, 0xb7, 0xae, 0xf3, 0x12, 0xc2, 0x18, 0x00, 0xde, 0xef, 0x12, 0x1f, 0x1e, 0x76, 0x42, 0x6a, 0x00, 0x66, 0x5e, 0x5c, 0x44, 0x79, 0x67, 0x43, 0x22, 0xd4, 0xf7, 0x5e, 0xda, 0xdd, 0x46, 0xde, 0xbd, 0x5c, 0xd9, 0x92, 0xf6, 0xed, 0x09, 0x06, 0x89, 0xd0, 0x58, 0x5f, 0xf0, 0x75, 0xec, 0x9e, 0x99, 0xad, 0x69, 0x0c, 0x33, 0x95, 0xbc, 0x4b, 0x31, 0x33, 0x70, 0xb3, 0x8e, 0xf3, 0x55, 0xac, 0xda, 0xdc, 0xd1, 0x22, 0x97, 0x5b, 0x12, 0xc8, 0x5e, 0xa5, 0xdb, 0x8c, 0x6d, 0xeb, 0x4a, 0xab, 0x71, 0x80, 0x8d, 0xcb, 0x40, 0x8f, 0xe3, 0xd1, 0xe7, 0x69, 0x0c, 0x43, 0xd3, 0x7b, 0x4c, 0xe6, 0xcc, 0x01, 0x66, 0xfa, 0x7d, 0xaa];
const SYN_VK_DELTA: [u8; BN254_G2_SERIALIZED_SIZE] = [0x13, 0x15, 0x62, 0xba, 0xbb, 0x61, 0x9b, 0xc9, 0x2b, 0x46, 0x72, 0xe7, 0x10, 0x41, 0xf9, 0xbe, 0x68, 0xbf, 0xd5, 0x95, 0x2a, 0xa0, 0xe4, 0x94, 0xf1, 0xf3, 0xb7, 0x03, 0xe6, 0x9f, 0x90, 0xa2, 0x2a, 0x2d, 0xfb, 0x26, 0x24, 0xb8, 0x11, 0x82, 0x77, 0xf1, 0xae, 0x47, 0x7e, 0x15, 0x8f, 0xd4, 0x74, 0xbf, 0xba, 0x17, 0xa2, 0x3d, 0xdf, 0x53, 0x48, 0x28, 0x8f, 0x49, 0x24, 0x5c, 0x70, 0x8f, 0x19, 0x8a, 0x10, 0x07, 0x6b, 0x35, 0x14, 0xf6, 0x0b, 0x69, 0x12, 0xf3, 0xfa, 0xef, 0x80, 0x17, 0xe7, 0x3c, 0xd5, 0x59, 0xbe, 0xb2, 0x83, 0x4b, 0xd0, 0xb7, 0x45, 0x45, 0x58, 0x5b, 0x27, 0x35, 0x15, 0xf0, 0x26, 0x20, 0xe2, 0x7d, 0xe2, 0x1c, 0x0c, 0xa0, 0xd2, 0x8e, 0x2f, 0xdf, 0x32, 0x70, 0x31, 0x8d, 0x69, 0x27, 0xaa, 0x44, 0xe3, 0x33, 0x6c, 0x27, 0x86, 0xfc, 0x93, 0x62, 0x73, 0xd8];
const SYN_VK_IC: [[u8; BN254_G1_SERIALIZED_SIZE]; 4] = [
    [0x2c, 0x3e, 0x73, 0xf6, 0x79, 0x8d, 0x54, 0xa8, 0xd6, 0xa2, 0x51, 0xd4, 0x29, 0x76, 0x14, 0xbc, 0xed, 0xdb, 0x73, 0x0f, 0x33, 0x1e, 0x2c, 0xd6, 0xd2, 0x72, 0x32, 0x4a, 0x36, 0xed, 0xf4, 0x5c, 0x22, 0x32, 0xf8, 0xd4, 0xf7, 0xb5, 0x03, 0x61, 0xe5, 0x88, 0x75, 0x02, 0xa3, 0xf7, 0x84, 0xc2, 0xae, 0xa7, 0xdb, 0x2b, 0x2b, 0xb9, 0x6d, 0xc5, 0x3e, 0xde, 0x31, 0x2a, 0x6b, 0x67, 0x7a, 0xed],
    [0x2a, 0x93, 0x64, 0x00, 0x88, 0x01, 0x80, 0x82, 0x4b, 0x17, 0x8c, 0xd2, 0xf5, 0x35, 0x45, 0x38, 0xb2, 0x01, 0xbc, 0x41, 0xc4, 0xd3, 0xc1, 0x65, 0x94, 0x69, 0xac, 0xb9, 0x38, 0xcf, 0x2b, 0x21, 0x0a, 0x4f, 0x12, 0xf3, 0x98, 0x78, 0xbc, 0x8c, 0xbf, 0xba, 0xcd, 0xd3, 0x25, 0x27, 0x84, 0xed, 0xba, 0xc7, 0xa7, 0x5a, 0x62, 0x13, 0xc7, 0xac, 0xa0, 0xe9, 0x72, 0xbf, 0x81, 0x1b, 0x35, 0x69],
    [0x11, 0x7d, 0xf7, 0xda, 0x56, 0xb7, 0xc6, 0x0e, 0xb7, 0xf1, 0xce, 0x98, 0x7b, 0xaf, 0xd7, 0xcd, 0x33, 0xdb, 0x60, 0xd8, 0xa7, 0xe9, 0x4e, 0x57, 0x9c, 0x9c, 0xa9, 0x1d, 0xad, 0xb5, 0x2e, 0x22, 0x24, 0x45, 0xf7, 0x9b, 0x1d, 0x81, 0x9c, 0x81, 0xbf, 0x44, 0x4f, 0x31, 0x63, 0xd0, 0x4a, 0xb8, 0x57, 0x04, 0x53, 0xc2, 0xb4, 0xff, 0x23, 0x05, 0x39, 0x8d, 0xad, 0xf4, 0x6e, 0xd5, 0x20, 0xe4],
    [0x2a, 0xf5, 0xd8, 0x9a, 0x31, 0x18, 0xbd, 0xf3, 0x49, 0x2d, 0x2f, 0x03, 0xd9, 0xeb, 0xee, 0xae, 0xde, 0x57, 0xb2, 0x0a, 0x38, 0x3b, 0xf7, 0x00, 0xb7, 0x65, 0x55, 0x0d, 0x50, 0x6b, 0x49, 0xd3, 0x18, 0x8b, 0x1b, 0x62, 0x9f, 0xec, 0xc8, 0x27, 0xd4, 0xe5, 0x7c, 0x82, 0x37, 0xf5, 0xf0, 0xa5, 0xb3, 0xe2, 0xa4, 0x55, 0x34, 0x5c, 0x3b, 0x3c, 0x27, 0xa1, 0xdd, 0xb8, 0x50, 0x44, 0xf4, 0xfa],
];

fn synthetic_vk(env: &Env) -> groth16::VerificationKey {
    let mut ic = Vec::new(env);
    for p in SYN_VK_IC.iter() {
        ic.push_back(Bn254G1Affine::from_array(env, p));
    }
    groth16::VerificationKey {
        alpha: Bn254G1Affine::from_array(env, &SYN_VK_ALPHA),
        beta: Bn254G2Affine::from_array(env, &SYN_VK_BETA),
        gamma: Bn254G2Affine::from_array(env, &SYN_VK_GAMMA),
        delta: Bn254G2Affine::from_array(env, &SYN_VK_DELTA),
        ic,
    }
}

/// A structurally valid Proof whose contents never reach the pairing check
/// in the tests that use it.
fn synthetic_proof(env: &Env) -> groth16::Proof {
    groth16::Proof {
        a: Bn254G1Affine::from_array(env, &SYN_VK_ALPHA),
        b: Bn254G2Affine::from_array(env, &SYN_VK_BETA),
        c: Bn254G1Affine::from_array(env, &SYN_VK_IC[0]),
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Register a SAC escrow token and the registry (with `vk` as the delivery
/// VK). Mocks all auths. Returns `(registry_client, token_address, merchant)`.
fn setup<'a>(
    env: &'a Env,
    vk: groth16::VerificationKey,
) -> (RegistryContractClient<'a>, Address, Address) {
    env.mock_all_auths();

    let token_admin = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(token_admin);
    let token = sac.address();
    let merchant = Address::generate(env);

    let admin = Address::generate(env);
    let credentials = Address::generate(env);
    let airspace = Address::generate(env);
    let id = env.register(
        RegistryContract,
        (
            admin,
            vk,
            None::<groth16::VerificationKey>,
            credentials,
            airspace,
        ),
    );
    (RegistryContractClient::new(env, &id), token, merchant)
}

fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
}

fn balance(env: &Env, token: &Address, of: &Address) -> i128 {
    TokenClient::new(env, token).balance(of)
}

/// Create a shipment with the pinned defaults (milestones `[10_000]`,
/// Courier, Transparent, no lane).
fn create_default(
    env: &Env,
    client: &RegistryContractClient,
    token: &Address,
    merchant: &Address,
    c_s: &U256,
) -> u64 {
    client.create_shipment(
        merchant,
        c_s,
        token,
        &AMOUNT,
        &vec![env, 10_000u32],
        &ESCROW_DEADLINE,
        &Method::Courier,
        &Rail::Transparent,
        &None::<u32>,
        &None::<Address>,
    )
}

fn fr(env: &Env, v: u32) -> Bn254Fr {
    Bn254Fr::from(U256::from_u32(env, v))
}

// ── Fixture-backed lifecycle tests ───────────────────────────────────────────

/// Full lifecycle create → accept → deliver with the real fixture proof.
/// Asserts state transitions, escrow movement (contract drained, payout
/// += amount), on-chain head == fixture head, and the spent nullifier.
#[test]
fn happy_courier_delivery() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, test_fixtures::delivery_vk(&env));
    let fx = test_fixtures::valid_delivery(&env);
    assert_eq!(fx.ts, POD_TS, "fixture must use the pinned PoD ts");
    mint(&env, &token, &merchant, AMOUNT);

    // Create: first id is 1 and must match the id the proof binds.
    let id = create_default(&env, &client, &token, &merchant, &fx.c_s);
    assert_eq!(id, 1, "counter must start at 1");
    assert_eq!(id, fx.shipment_id, "fixture binds shipment_id = 1");
    assert_eq!(balance(&env, &token, &client.address), AMOUNT);
    let st = client.status(&id);
    assert_eq!(st.state, State::Open);

    // Accept: head computed on-chain must equal the fixture's head.
    let carrier = Address::generate(&env);
    let payout = Address::generate(&env);
    client.accept(&id, &carrier, &payout, &fx.carrier_pk_commit);
    let st = client.status(&id);
    assert_eq!(st.state, State::InTransit);
    assert_eq!(st.accept_ts, ACCEPT_LEDGER_TS);
    assert_eq!(
        st.head,
        Some(fx.head.clone()),
        "on-chain custody head must match the fixture (nested arity-2 parity)"
    );
    assert_eq!(st.carrier, Some(carrier));
    assert_eq!(st.payout, Some(payout.clone()));

    // Deliver with the real proof.
    env.ledger().set_timestamp(DELIVER_LEDGER_TS);
    client.deliver(&id, &fx.proof, &fx.nullifier, &fx.ts);

    let st = client.status(&id);
    assert_eq!(st.state, State::Delivered);
    assert_eq!(st.paid, AMOUNT);
    assert_eq!(balance(&env, &token, &client.address), 0, "escrow drained");
    assert_eq!(balance(&env, &token, &payout), AMOUNT, "payout received all");

    // Nullifier is stored (I5).
    let spent = env.as_contract(&client.address, || {
        env.storage()
            .persistent()
            .has(&DataKey::Null(fx.nullifier.clone()))
    });
    assert!(spent, "nullifier must be persisted as spent");
}

/// T3: `deliver` needs no auth; a stranger's submission still pays the payout
/// address STORED at accept — front-running is a fee donation, not theft.
#[test]
fn frontrun_deliver() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, test_fixtures::delivery_vk(&env));
    let fx = test_fixtures::valid_delivery(&env);
    mint(&env, &token, &merchant, AMOUNT);

    let id = create_default(&env, &client, &token, &merchant, &fx.c_s);
    let carrier = Address::generate(&env);
    let payout = Address::generate(&env);
    client.accept(&id, &carrier, &payout, &fx.carrier_pk_commit);

    // Drop every authorization: the submitter authorizes nothing.
    env.ledger().set_timestamp(DELIVER_LEDGER_TS);
    env.set_auths(&[]);
    client.deliver(&id, &fx.proof, &fx.nullifier, &fx.ts);

    assert_eq!(client.status(&id).state, State::Delivered);
    assert_eq!(
        balance(&env, &token, &payout),
        AMOUNT,
        "funds must go to the STORED payout regardless of submitter"
    );
}

/// T1/T2: the fixture proof binds shipment_id = 1; replaying it against
/// shipment 2 (same params, same carrier_pk_commit) must fail BadProof —
/// the storage-derived signals (id, head) differ.
#[test]
fn replay_cross_shipment() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, test_fixtures::delivery_vk(&env));
    let fx = test_fixtures::valid_delivery(&env);
    mint(&env, &token, &merchant, 2 * AMOUNT);

    let id1 = create_default(&env, &client, &token, &merchant, &fx.c_s);
    assert_eq!(id1, 1);
    let id2 = create_default(&env, &client, &token, &merchant, &fx.c_s);
    assert_eq!(id2, 2);

    let carrier = Address::generate(&env);
    let payout = Address::generate(&env);
    client.accept(&id2, &carrier, &payout, &fx.carrier_pk_commit);

    env.ledger().set_timestamp(DELIVER_LEDGER_TS);
    let res = client.try_deliver(&id2, &fx.proof, &fx.nullifier, &fx.ts);
    assert_eq!(
        res,
        Err(Ok(Error::BadProof)),
        "a proof bound to shipment 1 must not verify for shipment 2"
    );
}

/// I4: deliver before accept → WrongState; deliver again after Delivered →
/// WrongState (state check fires before the nullifier check).
#[test]
fn deliver_wrong_state() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, test_fixtures::delivery_vk(&env));
    let fx = test_fixtures::valid_delivery(&env);
    mint(&env, &token, &merchant, AMOUNT);

    let id = create_default(&env, &client, &token, &merchant, &fx.c_s);

    // Still Open — deliver must be rejected.
    let res = client.try_deliver(&id, &fx.proof, &fx.nullifier, &fx.ts);
    assert_eq!(res, Err(Ok(Error::WrongState)), "deliver before accept");

    let carrier = Address::generate(&env);
    let payout = Address::generate(&env);
    client.accept(&id, &carrier, &payout, &fx.carrier_pk_commit);
    env.ledger().set_timestamp(DELIVER_LEDGER_TS);
    client.deliver(&id, &fx.proof, &fx.nullifier, &fx.ts);

    // Already Delivered — second deliver rejected on state, not nullifier.
    let res = client.try_deliver(&id, &fx.proof, &fx.nullifier, &fx.ts);
    assert_eq!(res, Err(Ok(Error::WrongState)), "deliver after Delivered");
}

/// I9: ledger far ahead of ts → StaleTs; ts ≤ accept_ts → TsBeforeAccept.
#[test]
fn stale_ts() {
    // Scenario A: window exceeded (700 s > WINDOW_SEC = 600).
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, test_fixtures::delivery_vk(&env));
    let fx = test_fixtures::valid_delivery(&env);
    mint(&env, &token, &merchant, AMOUNT);
    let id = create_default(&env, &client, &token, &merchant, &fx.c_s);
    let carrier = Address::generate(&env);
    let payout = Address::generate(&env);
    client.accept(&id, &carrier, &payout, &fx.carrier_pk_commit);

    env.ledger().set_timestamp(1_800_000_700);
    let res = client.try_deliver(&id, &fx.proof, &fx.nullifier, &fx.ts);
    assert_eq!(res, Err(Ok(Error::StaleTs)), "|now - ts| = 700 > 600");

    // Scenario B: accept_ts == ts, so ts is not strictly after accept.
    let env = Env::default();
    env.ledger().set_timestamp(POD_TS); // accept exactly at the PoD ts
    let (client, token, merchant) = setup(&env, test_fixtures::delivery_vk(&env));
    let fx = test_fixtures::valid_delivery(&env);
    mint(&env, &token, &merchant, AMOUNT);
    let id = create_default(&env, &client, &token, &merchant, &fx.c_s);
    let carrier = Address::generate(&env);
    let payout = Address::generate(&env);
    client.accept(&id, &carrier, &payout, &fx.carrier_pk_commit);

    env.ledger().set_timestamp(DELIVER_LEDGER_TS); // window fine (60 s)
    let res = client.try_deliver(&id, &fx.proof, &fx.nullifier, &fx.ts);
    assert_eq!(
        res,
        Err(Ok(Error::TsBeforeAccept)),
        "ts == accept_ts must be rejected"
    );
}

/// I4: method = Drone with flight_ok == false (no submit_flight in this
/// build) must be undeliverable: FlightRequired.
#[test]
fn drone_requires_flight() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, test_fixtures::delivery_vk(&env));
    let fx = test_fixtures::valid_delivery(&env);
    mint(&env, &token, &merchant, AMOUNT);

    let id = client.create_shipment(
        &merchant,
        &fx.c_s,
        &token,
        &AMOUNT,
        &vec![&env, 10_000u32],
        &ESCROW_DEADLINE,
        &Method::Drone,
        &Rail::Transparent,
        &Some(1u32),
        &None::<Address>,
    );
    let carrier = Address::generate(&env);
    let payout = Address::generate(&env);
    client.accept(&id, &carrier, &payout, &fx.carrier_pk_commit);

    env.ledger().set_timestamp(DELIVER_LEDGER_TS);
    let res = client.try_deliver(&id, &fx.proof, &fx.nullifier, &fx.ts);
    assert_eq!(res, Err(Ok(Error::FlightRequired)));
}

// ── Fixture-free tests ───────────────────────────────────────────────────────

/// T11: before the deadline refunds are rejected; after it, a stranger (no
/// auth) can expire the shipment and the merchant gets the escrow back;
/// a second refund is WrongState.
#[test]
fn timeout_refund() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, synthetic_vk(&env));
    mint(&env, &token, &merchant, AMOUNT);

    let c_s = U256::from_u32(&env, 7);
    let id = create_default(&env, &client, &token, &merchant, &c_s);
    assert_eq!(balance(&env, &token, &client.address), AMOUNT);
    assert_eq!(balance(&env, &token, &merchant), 0);

    // Deadline not yet passed (also at exactly the deadline).
    let res = client.try_refund_expired(&id);
    assert_eq!(res, Err(Ok(Error::DeadlineNotPassed)));
    env.ledger().set_timestamp(ESCROW_DEADLINE);
    let res = client.try_refund_expired(&id);
    assert_eq!(res, Err(Ok(Error::DeadlineNotPassed)), "== deadline is not past");

    // Past the deadline: permissionless — no auths mocked from here on.
    env.ledger().set_timestamp(ESCROW_DEADLINE + 1);
    env.set_auths(&[]);
    client.refund_expired(&id);

    let st = client.status(&id);
    assert_eq!(st.state, State::Expired);
    assert_eq!(balance(&env, &token, &merchant), AMOUNT, "merchant refunded");
    assert_eq!(balance(&env, &token, &client.address), 0);

    // Refund again → WrongState.
    let res = client.try_refund_expired(&id);
    assert_eq!(res, Err(Ok(Error::WrongState)));
}

/// T20/I7: milestones [3_333, 6_667] on amount 10_001 — accept pays exactly
/// floor(10_001·3_333/10_000) = 3_333, `paid` tracks it, and the remainder
/// (6_668) stays escrowed for the final milestone. Bad vectors are rejected.
#[test]
fn milestone_dust() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, synthetic_vk(&env));
    let amount: i128 = 10_001;
    mint(&env, &token, &merchant, amount);
    let c_s = U256::from_u32(&env, 7);

    let id = client.create_shipment(
        &merchant,
        &c_s,
        &token,
        &amount,
        &vec![&env, 3_333u32, 6_667u32],
        &ESCROW_DEADLINE,
        &Method::Courier,
        &Rail::Transparent,
        &None::<u32>,
        &None::<Address>,
    );

    let carrier = Address::generate(&env);
    let payout = Address::generate(&env);
    client.accept(&id, &carrier, &payout, &U256::from_u32(&env, 9));

    // Milestone 0 released at accept: exactly 3_333 (integer floor).
    assert_eq!(balance(&env, &token, &payout), 3_333);
    let st = client.status(&id);
    assert_eq!(st.paid, 3_333, "paid tracking");
    assert_eq!(
        balance(&env, &token, &client.address),
        6_668,
        "remainder (amount − paid) stays escrowed for deliver"
    );
    assert_eq!(st.amount - st.paid, 6_668);

    // Σ != 10_000 → BadMilestones.
    let res = client.try_create_shipment(
        &merchant, &c_s, &token, &amount,
        &vec![&env, 3_333u32, 6_666u32],
        &ESCROW_DEADLINE, &Method::Courier, &Rail::Transparent, &None::<u32>,
        &None::<Address>,
    );
    assert_eq!(res, Err(Ok(Error::BadMilestones)), "sum 9_999");

    // len 3 → BadMilestones.
    let res = client.try_create_shipment(
        &merchant, &c_s, &token, &amount,
        &vec![&env, 3_000u32, 3_000u32, 4_000u32],
        &ESCROW_DEADLINE, &Method::Courier, &Rail::Transparent, &None::<u32>,
        &None::<Address>,
    );
    assert_eq!(res, Err(Ok(Error::BadMilestones)), "len 3");

    // Zero share → BadMilestones (even though the sum is 10_000).
    let res = client.try_create_shipment(
        &merchant, &c_s, &token, &amount,
        &vec![&env, 0u32, 10_000u32],
        &ESCROW_DEADLINE, &Method::Courier, &Rail::Transparent, &None::<u32>,
        &None::<Address>,
    );
    assert_eq!(res, Err(Ok(Error::BadMilestones)), "zero milestone");
}

/// create_shipment input validation: zero amount, non-future deadline,
/// confidential rail.
#[test]
fn create_validation() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000_000);
    let (client, token, merchant) = setup(&env, synthetic_vk(&env));
    mint(&env, &token, &merchant, AMOUNT);
    let c_s = U256::from_u32(&env, 7);
    let milestones = vec![&env, 10_000u32];

    // amount == 0 → AmountInvalid.
    let res = client.try_create_shipment(
        &merchant, &c_s, &token, &0i128, &milestones,
        &2_000_000u64, &Method::Courier, &Rail::Transparent, &None::<u32>,
        &None::<Address>,
    );
    assert_eq!(res, Err(Ok(Error::AmountInvalid)));

    // Deadline in the past → DeadlineInvalid.
    let res = client.try_create_shipment(
        &merchant, &c_s, &token, &AMOUNT, &milestones,
        &999_999u64, &Method::Courier, &Rail::Transparent, &None::<u32>,
        &None::<Address>,
    );
    assert_eq!(res, Err(Ok(Error::DeadlineInvalid)));

    // Deadline == now is also not in the future.
    let res = client.try_create_shipment(
        &merchant, &c_s, &token, &AMOUNT, &milestones,
        &1_000_000u64, &Method::Courier, &Rail::Transparent, &None::<u32>,
        &None::<Address>,
    );
    assert_eq!(res, Err(Ok(Error::DeadlineInvalid)));

    // Confidential rail is now supported (§6.6), but not before set_ct_token
    // wires the hooked token's address → CtTokenUnset.
    let res = client.try_create_shipment(
        &merchant, &c_s, &token, &AMOUNT, &milestones,
        &2_000_000u64, &Method::Courier, &Rail::Confidential, &None::<u32>,
        &None::<Address>,
    );
    assert_eq!(res, Err(Ok(Error::CtTokenUnset)));
}

/// I3/I4: a second accept is rejected on state, so carrier/payout are
/// write-once — the first accept's values survive untouched.
#[test]
fn accept_wrong_state() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, synthetic_vk(&env));
    mint(&env, &token, &merchant, AMOUNT);
    let c_s = U256::from_u32(&env, 7);
    let id = create_default(&env, &client, &token, &merchant, &c_s);

    let carrier1 = Address::generate(&env);
    let payout1 = Address::generate(&env);
    let pkc1 = U256::from_u32(&env, 11);
    client.accept(&id, &carrier1, &payout1, &pkc1);

    // Second accept (any carrier, even the same one) → WrongState.
    let carrier2 = Address::generate(&env);
    let payout2 = Address::generate(&env);
    let res = client.try_accept(&id, &carrier2, &payout2, &U256::from_u32(&env, 12));
    assert_eq!(res, Err(Ok(Error::WrongState)));

    // Stored custody fields are still the first accept's (write-once, I3).
    let st = client.status(&id);
    assert_eq!(st.carrier, Some(carrier1));
    assert_eq!(st.payout, Some(payout1));
    assert_eq!(st.carrier_pk_commit, Some(pkc1.clone()));
    assert_eq!(
        st.head,
        Some(aegis_common::custody_head(&env, id, &pkc1)),
        "head still derives from the first accept"
    );
}

/// Without the merchant's authorization, create_shipment is rejected.
#[test]
fn unauthorized_create() {
    let env = Env::default(); // no mocked auths at all
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);

    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin);
    let token = sac.address();
    let merchant = Address::generate(&env);
    let admin = Address::generate(&env);
    let credentials = Address::generate(&env);
    let airspace = Address::generate(&env);
    let id = env.register(
        RegistryContract,
        (
            admin,
            synthetic_vk(&env),
            None::<groth16::VerificationKey>,
            credentials,
            airspace,
        ),
    );
    let client = RegistryContractClient::new(&env, &id);

    let res = client.try_create_shipment(
        &merchant,
        &U256::from_u32(&env, 7),
        &token,
        &AMOUNT,
        &vec![&env, 10_000u32],
        &ESCROW_DEADLINE,
        &Method::Courier,
        &Rail::Transparent,
        &None::<u32>,
        &None::<Address>,
    );
    assert!(res.is_err(), "create without merchant auth must be rejected");
}

/// Without the carrier's authorization, accept is rejected.
#[test]
fn unauthorized_accept() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, synthetic_vk(&env));
    mint(&env, &token, &merchant, AMOUNT);
    let c_s = U256::from_u32(&env, 7);
    let id = create_default(&env, &client, &token, &merchant, &c_s);

    // Drop all mocked auths: the carrier no longer signs.
    env.set_auths(&[]);
    let carrier = Address::generate(&env);
    let payout = Address::generate(&env);
    let res = client.try_accept(&id, &carrier, &payout, &U256::from_u32(&env, 9));
    assert!(res.is_err(), "accept without carrier auth must be rejected");

    // Shipment untouched.
    assert_eq!(client.status(&id).state, State::Open);
}

/// groth16::verify must return false (not panic/error) when the number of
/// public signals doesn't match the VK's IC length (len + 1 == ic.len()).
#[test]
fn vk_signal_len_mismatch() {
    let env = Env::default();
    let vk = synthetic_vk(&env); // ic.len() == 4 → expects exactly 3 signals
    let proof = synthetic_proof(&env);

    // Too few (0, 1, 2) and too many (4) signals: all must be rejected
    // before any curve operation runs.
    let s0: Vec<Bn254Fr> = Vec::new(&env);
    assert!(!groth16::verify(&env, &vk, &proof, s0));

    let s1 = vec![&env, fr(&env, 1)];
    assert!(!groth16::verify(&env, &vk, &proof, s1));

    let s2 = vec![&env, fr(&env, 1), fr(&env, 2)];
    assert!(!groth16::verify(&env, &vk, &proof, s2));

    let s4 = vec![&env, fr(&env, 1), fr(&env, 2), fr(&env, 3), fr(&env, 4)];
    assert!(!groth16::verify(&env, &vk, &proof, s4));
}

// ── Flight (Drone) tests ──────────────────────────────────────────────────────
//
// Pinned scenario (MUST match the parallel `test_fixtures_flight` generator):
//   throwaway courier shipment id 1, drone shipment id 2 (Drone, lane 7),
//   accept at ledger 1_799_999_990, t_0 = 1_800_000_000, t_n = 1_800_000_300,
//   submit_flight at ledger 1_800_000_350, drone deliver at ledger 1_800_000_420.
//
// Tests that consume the flight fixture are `#[ignore]` until the generated
// bytes land (the placeholder bodies `unimplemented!()`); they must still
// compile. The fixture-free negative tests (`submit_flight_not_drone`,
// `vk_missing`) run in the default suite.

/// Register a SAC token, a merchant, and a REAL `aegis-airspace` contract, then
/// the registry wired to that airspace with the given delivery/flight VKs.
/// Mocks all auths. Returns `(registry, airspace, token, merchant)`.
fn setup_flight<'a>(
    env: &'a Env,
    vk_delivery: groth16::VerificationKey,
    vk_flight: Option<groth16::VerificationKey>,
) -> (
    RegistryContractClient<'a>,
    aegis_airspace::AirspaceContractClient<'a>,
    Address,
    Address,
) {
    env.mock_all_auths();

    let token_admin = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(token_admin);
    let token = sac.address();
    let merchant = Address::generate(env);

    let admin = Address::generate(env);
    let credentials = Address::generate(env);

    // The registry reads corridor roots from THIS real airspace (I1/T22).
    let authority = Address::generate(env);
    let airspace_id = env.register(aegis_airspace::AirspaceContract, (authority,));

    let registry_id = env.register(
        RegistryContract,
        (admin, vk_delivery, vk_flight, credentials, airspace_id.clone()),
    );

    (
        RegistryContractClient::new(env, &registry_id),
        aegis_airspace::AirspaceContractClient::new(env, &airspace_id),
        token,
        merchant,
    )
}

/// Create a throwaway courier shipment (id 1) so the drone shipment lands on the
/// pinned id 2 (Drone, lane 7, `c_s`), then accept it with `carrier_pk_commit`
/// at `accept_ledger`. Returns `(drone_id = 2, payout)`. Caller mints escrow.
fn create_and_accept_drone(
    env: &Env,
    client: &RegistryContractClient,
    token: &Address,
    merchant: &Address,
    c_s: &U256,
    carrier_pk_commit: &U256,
    accept_ledger: u64,
) -> (u64, Address) {
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let _throwaway = create_default(env, client, token, merchant, c_s);

    let id = client.create_shipment(
        merchant,
        c_s,
        token,
        &AMOUNT,
        &vec![env, 10_000u32],
        &ESCROW_DEADLINE,
        &Method::Drone,
        &Rail::Transparent,
        &Some(FLIGHT_LANE),
        &None::<Address>,
    );
    assert_eq!(id, 2, "drone shipment must land on pinned id 2");

    let carrier = Address::generate(env);
    let payout = Address::generate(env);
    env.ledger().set_timestamp(accept_ledger);
    client.accept(&id, &carrier, &payout, carrier_pk_commit);
    (id, payout)
}

/// Full drone lifecycle: authority approves the corridor, create+accept →
/// on-chain head matches the fixture, submit_flight verifies (flight_ok set),
/// then deliver releases the full escrow to the stored payout.
#[test]
fn drone_happy_e2e() {
    let env = Env::default();
    let (client, airspace, token, merchant) = setup_flight(
        &env,
        test_fixtures::delivery_vk(&env),
        Some(test_fixtures_flight::flight_vk(&env)),
    );
    let fx = test_fixtures_flight::valid_flight(&env);
    assert_eq!(fx.t_0, FLIGHT_T0, "fixture must bind the pinned t_0");
    assert_eq!(fx.t_n, FLIGHT_TN, "fixture must bind the pinned t_n");
    mint(&env, &token, &merchant, 2 * AMOUNT);

    // Authority approves lane 7 with the fixture's corridor root (I1: root
    // comes from the airspace store, then into the proof's public inputs).
    airspace.approve_corridor(&FLIGHT_LANE, &fx.corridor_root, &CORRIDOR_FROM, &CORRIDOR_TO);

    let (id, payout) = create_and_accept_drone(
        &env,
        &client,
        &token,
        &merchant,
        &fx.c_s,
        &fx.carrier_pk_commit,
        ACCEPT_LEDGER_TS,
    );
    assert_eq!(id, fx.shipment_id, "fixture binds shipment_id = 2");
    assert_eq!(
        client.status(&id).head,
        Some(fx.head.clone()),
        "on-chain custody head must match the fixture"
    );

    // submit_flight verifies the A2 proof against the stored corridor root.
    env.ledger().set_timestamp(SUBMIT_FLIGHT_LEDGER);
    client.submit_flight(&id, &fx.proof, &fx.t_0, &fx.t_n);
    assert!(client.status(&id).flight_ok, "flight_ok set after submit_flight");

    // deliver the drone shipment with the drone-delivery fixture.
    let dd = test_fixtures_flight::drone_delivery(&env);
    env.ledger().set_timestamp(DRONE_DELIVER_LEDGER);
    client.deliver(&id, &dd.proof, &dd.nullifier, &dd.ts);

    let st = client.status(&id);
    assert_eq!(st.state, State::Delivered);
    assert_eq!(st.paid, AMOUNT);
    assert_eq!(balance(&env, &token, &payout), AMOUNT, "payout received all");
    // The helper parked a throwaway courier shipment (id 1) to pin the drone
    // shipment at id 2 — its untouched escrow is all that may remain.
    assert_eq!(
        balance(&env, &token, &client.address),
        AMOUNT,
        "only the throwaway shipment's escrow remains"
    );
}

/// I4: a Drone shipment with a verified-nothing flight (flight_ok == false) is
/// undeliverable — deliver returns FlightRequired even with a valid proof.
#[test]
fn deliver_before_flight() {
    let env = Env::default();
    let (client, airspace, token, merchant) = setup_flight(
        &env,
        test_fixtures::delivery_vk(&env),
        Some(test_fixtures_flight::flight_vk(&env)),
    );
    let fx = test_fixtures_flight::valid_flight(&env);
    mint(&env, &token, &merchant, 2 * AMOUNT);
    airspace.approve_corridor(&FLIGHT_LANE, &fx.corridor_root, &CORRIDOR_FROM, &CORRIDOR_TO);

    let (id, _payout) = create_and_accept_drone(
        &env, &client, &token, &merchant, &fx.c_s, &fx.carrier_pk_commit, ACCEPT_LEDGER_TS,
    );

    // Deliver WITHOUT submit_flight first.
    let dd = test_fixtures_flight::drone_delivery(&env);
    env.ledger().set_timestamp(DRONE_DELIVER_LEDGER);
    let res = client.try_deliver(&id, &dd.proof, &dd.nullifier, &dd.ts);
    assert_eq!(res, Err(Ok(Error::FlightRequired)));
}

/// T7/T1: the fixture proof binds shipment 2; replaying it against a different
/// drone shipment (id 3, same lane) fails BadProof — the storage-derived
/// signals (id, head) differ.
#[test]
fn flight_replay_other_shipment() {
    let env = Env::default();
    let (client, airspace, token, merchant) = setup_flight(
        &env,
        test_fixtures::delivery_vk(&env),
        Some(test_fixtures_flight::flight_vk(&env)),
    );
    let fx = test_fixtures_flight::valid_flight(&env);
    mint(&env, &token, &merchant, 3 * AMOUNT);
    airspace.approve_corridor(&FLIGHT_LANE, &fx.corridor_root, &CORRIDOR_FROM, &CORRIDOR_TO);

    // ids 1 (throwaway) + 2 (drone) via the helper, then a third drone shipment.
    let _drone2 = create_and_accept_drone(
        &env, &client, &token, &merchant, &fx.c_s, &fx.carrier_pk_commit, ACCEPT_LEDGER_TS,
    );
    let id3 = client.create_shipment(
        &merchant,
        &fx.c_s,
        &token,
        &AMOUNT,
        &vec![&env, 10_000u32],
        &ESCROW_DEADLINE,
        &Method::Drone,
        &Rail::Transparent,
        &Some(FLIGHT_LANE),
        &None::<Address>,
    );
    assert_eq!(id3, 3);
    let carrier = Address::generate(&env);
    let payout = Address::generate(&env);
    client.accept(&id3, &carrier, &payout, &fx.carrier_pk_commit);

    env.ledger().set_timestamp(SUBMIT_FLIGHT_LEDGER);
    let res = client.try_submit_flight(&id3, &fx.proof, &fx.t_0, &fx.t_n);
    assert_eq!(
        res,
        Err(Ok(Error::BadProof)),
        "a flight proof bound to shipment 2 must not verify for shipment 3"
    );
}

/// A second submit_flight after a successful one is rejected on state
/// (flight_ok already true) → WrongState (no re-submission).
#[test]
fn flight_resubmission() {
    let env = Env::default();
    let (client, airspace, token, merchant) = setup_flight(
        &env,
        test_fixtures::delivery_vk(&env),
        Some(test_fixtures_flight::flight_vk(&env)),
    );
    let fx = test_fixtures_flight::valid_flight(&env);
    mint(&env, &token, &merchant, 2 * AMOUNT);
    airspace.approve_corridor(&FLIGHT_LANE, &fx.corridor_root, &CORRIDOR_FROM, &CORRIDOR_TO);

    let (id, _payout) = create_and_accept_drone(
        &env, &client, &token, &merchant, &fx.c_s, &fx.carrier_pk_commit, ACCEPT_LEDGER_TS,
    );

    env.ledger().set_timestamp(SUBMIT_FLIGHT_LEDGER);
    client.submit_flight(&id, &fx.proof, &fx.t_0, &fx.t_n);
    assert!(client.status(&id).flight_ok);

    let res = client.try_submit_flight(&id, &fx.proof, &fx.t_0, &fx.t_n);
    assert_eq!(res, Err(Ok(Error::WrongState)), "no flight re-submission");
}

/// I9: submit_flight far past t_n → StaleTs (|1000 − 300| = 700 > WINDOW 600).
/// No corridor is approved here: freshness (step 2) must fire before the
/// corridor read (step 4), so the check ordering is exercised too.
#[test]
fn stale_flight() {
    let env = Env::default();
    let (client, _airspace, token, merchant) = setup_flight(
        &env,
        test_fixtures::delivery_vk(&env),
        Some(test_fixtures_flight::flight_vk(&env)),
    );
    let fx = test_fixtures_flight::valid_flight(&env);
    mint(&env, &token, &merchant, 2 * AMOUNT);

    let (id, _payout) = create_and_accept_drone(
        &env, &client, &token, &merchant, &fx.c_s, &fx.carrier_pk_commit, ACCEPT_LEDGER_TS,
    );

    env.ledger().set_timestamp(1_800_001_000);
    let res = client.try_submit_flight(&id, &fx.proof, &fx.t_0, &fx.t_n);
    assert_eq!(res, Err(Ok(Error::StaleTs)), "|now - t_n| = 700 > 600");
}

/// I9: accept later than t_0 (accept_ts = 1_800_000_100 > t_0 = 1_800_000_000)
/// → TsBeforeAccept. Again no corridor is approved: this check (step 2) must
/// precede the corridor read.
#[test]
fn flight_t0_before_accept() {
    let env = Env::default();
    let (client, _airspace, token, merchant) = setup_flight(
        &env,
        test_fixtures::delivery_vk(&env),
        Some(test_fixtures_flight::flight_vk(&env)),
    );
    let fx = test_fixtures_flight::valid_flight(&env);
    mint(&env, &token, &merchant, 2 * AMOUNT);

    // Accept AFTER t_0 so t_0 < accept_ts.
    let (id, _payout) = create_and_accept_drone(
        &env, &client, &token, &merchant, &fx.c_s, &fx.carrier_pk_commit, 1_800_000_100,
    );

    env.ledger().set_timestamp(SUBMIT_FLIGHT_LEDGER);
    let res = client.try_submit_flight(&id, &fx.proof, &fx.t_0, &fx.t_n);
    assert_eq!(res, Err(Ok(Error::TsBeforeAccept)), "t_0 < accept_ts");
}

/// The stored corridor's window must cover the ledger time: a window that ended
/// long ago → CorridorExpired (window enforced by the registry, not airspace).
#[test]
fn corridor_expired() {
    let env = Env::default();
    let (client, airspace, token, merchant) = setup_flight(
        &env,
        test_fixtures::delivery_vk(&env),
        Some(test_fixtures_flight::flight_vk(&env)),
    );
    let fx = test_fixtures_flight::valid_flight(&env);
    mint(&env, &token, &merchant, 2 * AMOUNT);

    // Correct root, but the window ended before the flight.
    airspace.approve_corridor(&FLIGHT_LANE, &fx.corridor_root, &1_700_000_000u64, &1_750_000_000u64);

    let (id, _payout) = create_and_accept_drone(
        &env, &client, &token, &merchant, &fx.c_s, &fx.carrier_pk_commit, ACCEPT_LEDGER_TS,
    );

    env.ledger().set_timestamp(SUBMIT_FLIGHT_LEDGER);
    let res = client.try_submit_flight(&id, &fx.proof, &fx.t_0, &fx.t_n);
    assert_eq!(res, Err(Ok(Error::CorridorExpired)));
}

/// T22/I1: the authority approves a DIFFERENT root for lane 7. The registry
/// feeds THAT stored root into the public inputs, so the proof (which binds the
/// real corridor root) fails → BadProof. This is I1 working.
#[test]
fn stale_root_rejected() {
    let env = Env::default();
    let (client, airspace, token, merchant) = setup_flight(
        &env,
        test_fixtures::delivery_vk(&env),
        Some(test_fixtures_flight::flight_vk(&env)),
    );
    let fx = test_fixtures_flight::valid_flight(&env);
    mint(&env, &token, &merchant, 2 * AMOUNT);

    // A stale/wrong root (not the fixture's), valid window.
    airspace.approve_corridor(&FLIGHT_LANE, &U256::from_u32(&env, 999), &CORRIDOR_FROM, &CORRIDOR_TO);

    let (id, _payout) = create_and_accept_drone(
        &env, &client, &token, &merchant, &fx.c_s, &fx.carrier_pk_commit, ACCEPT_LEDGER_TS,
    );

    env.ledger().set_timestamp(SUBMIT_FLIGHT_LEDGER);
    let res = client.try_submit_flight(&id, &fx.proof, &fx.t_0, &fx.t_n);
    assert_eq!(
        res,
        Err(Ok(Error::BadProof)),
        "a proof bound to the real root must not verify against a stale stored root"
    );
}

/// submit_flight on a Courier shipment → NotDrone (step 1, before any proof or
/// corridor work). Fixture-free: uses the delivery fixture's proof, which is
/// never reached.
#[test]
fn submit_flight_not_drone() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, _airspace, token, merchant) =
        setup_flight(&env, synthetic_vk(&env), Some(synthetic_vk(&env)));
    let fx = test_fixtures::valid_delivery(&env);
    mint(&env, &token, &merchant, AMOUNT);

    // A Courier shipment, accepted → InTransit.
    let id = create_default(&env, &client, &token, &merchant, &fx.c_s);
    let carrier = Address::generate(&env);
    let payout = Address::generate(&env);
    client.accept(&id, &carrier, &payout, &fx.carrier_pk_commit);

    env.ledger().set_timestamp(SUBMIT_FLIGHT_LEDGER);
    let res = client.try_submit_flight(&id, &fx.proof, &FLIGHT_T0, &FLIGHT_TN);
    assert_eq!(res, Err(Ok(Error::NotDrone)));
}

/// A Drone shipment created with `lane_id = None` → NoLane (step 3): there is
/// no corridor to check against.
#[test]
fn submit_flight_no_lane() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, _airspace, token, merchant) = setup_flight(
        &env,
        test_fixtures::delivery_vk(&env),
        Some(test_fixtures_flight::flight_vk(&env)),
    );
    let fx = test_fixtures_flight::valid_flight(&env);
    mint(&env, &token, &merchant, AMOUNT);

    // Drone shipment with NO lane.
    let id = client.create_shipment(
        &merchant,
        &fx.c_s,
        &token,
        &AMOUNT,
        &vec![&env, 10_000u32],
        &ESCROW_DEADLINE,
        &Method::Drone,
        &Rail::Transparent,
        &None::<u32>,
        &None::<Address>,
    );
    let carrier = Address::generate(&env);
    let payout = Address::generate(&env);
    client.accept(&id, &carrier, &payout, &fx.carrier_pk_commit);

    env.ledger().set_timestamp(SUBMIT_FLIGHT_LEDGER);
    let res = client.try_submit_flight(&id, &fx.proof, &fx.t_0, &fx.t_n);
    assert_eq!(res, Err(Ok(Error::NoLane)));
}

/// A deployment constructed without a flight VK (None) cannot verify flights:
/// submit_flight reaches the VK check (step 5) and returns VkMissing. The
/// corridor IS approved so steps 1–4 pass; a synthetic proof suffices because
/// verification is never reached. Fixture-free.
#[test]
fn vk_missing() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    // No flight VK.
    let (client, airspace, token, merchant) = setup_flight(&env, synthetic_vk(&env), None);
    mint(&env, &token, &merchant, AMOUNT);

    // Corridor approved so the corridor read (step 4) passes and we reach the
    // VK check (step 5). Root is arbitrary — verification is never reached.
    airspace.approve_corridor(&FLIGHT_LANE, &U256::from_u32(&env, 42), &CORRIDOR_FROM, &CORRIDOR_TO);

    let c_s = U256::from_u32(&env, 7);
    let id = client.create_shipment(
        &merchant,
        &c_s,
        &token,
        &AMOUNT,
        &vec![&env, 10_000u32],
        &ESCROW_DEADLINE,
        &Method::Drone,
        &Rail::Transparent,
        &Some(FLIGHT_LANE),
        &None::<Address>,
    );
    let carrier = Address::generate(&env);
    let payout = Address::generate(&env);
    client.accept(&id, &carrier, &payout, &U256::from_u32(&env, 11));

    env.ledger().set_timestamp(SUBMIT_FLIGHT_LEDGER);
    let res = client.try_submit_flight(&id, &synthetic_proof(&env), &FLIGHT_T0, &FLIGHT_TN);
    assert_eq!(res, Err(Ok(Error::VkMissing)));
}

// ── Confidential rail (§6.6 hook-caged escrow) tests ─────────────────────────
//
// The registry side only: state + the `escrow_of`/`release_allowed` views the
// hooked CT token cross-calls. All fixture-free except the two lifecycle tests
// that reuse the delivery fixture — the fixture binds shipment_id = 1 and is
// rail-agnostic (the A1 signals never mention amount or rail), so a
// confidential shipment created FIRST consumes it unchanged.

/// Create a confidential shipment with the pinned defaults: amount 0
/// (the registry never learns the real amount), milestones `[10_000]`,
/// Courier, no lane, escrow account `escrow`.
fn create_confidential(
    env: &Env,
    client: &RegistryContractClient,
    token: &Address,
    merchant: &Address,
    c_s: &U256,
    escrow: &Address,
) -> u64 {
    client.create_shipment(
        merchant,
        c_s,
        token,
        &0i128,
        &vec![env, 10_000u32],
        &ESCROW_DEADLINE,
        &Method::Courier,
        &Rail::Confidential,
        &None::<u32>,
        &Some(escrow.clone()),
    )
}

/// set_ct_token is set-once: the first call pins, the second (any address)
/// → AlreadySet; without admin auth the setter is rejected outright.
#[test]
fn set_ct_token_once() {
    let env = Env::default();
    let (client, _token, _merchant) = setup(&env, synthetic_vk(&env));
    assert_eq!(client.ct_token(), None, "unset before set_ct_token");

    let ct = Address::generate(&env);
    client.set_ct_token(&ct);
    assert_eq!(client.ct_token(), Some(ct.clone()));

    // Second set → AlreadySet (immutable mutual pin, §6.6/T25).
    let res = client.try_set_ct_token(&Address::generate(&env));
    assert_eq!(res, Err(Ok(Error::AlreadySet)));
    assert_eq!(client.ct_token(), Some(ct), "pin untouched");

    // Non-admin (no authorization at all) → auth error, token stays unset.
    let env2 = Env::default();
    let (client2, _t2, _m2) = setup(&env2, synthetic_vk(&env2));
    env2.set_auths(&[]);
    let res = client2.try_set_ct_token(&Address::generate(&env2));
    assert!(res.is_err(), "set_ct_token without admin auth must be rejected");
    assert_eq!(client2.ct_token(), None);
}

/// Confidential create before `set_ct_token` → CtTokenUnset: no escrow may
/// exist before the registry↔token mutual pin (T25).
#[test]
fn ct_create_requires_token_set() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, synthetic_vk(&env));

    let res = client.try_create_shipment(
        &merchant, &U256::from_u32(&env, 7), &token, &0i128,
        &vec![&env, 10_000u32], &ESCROW_DEADLINE, &Method::Courier,
        &Rail::Confidential, &None::<u32>, &Some(Address::generate(&env)),
    );
    assert_eq!(res, Err(Ok(Error::CtTokenUnset)));
}

/// Confidential create with `escrow = None` → EscrowRequired.
#[test]
fn ct_create_requires_escrow() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, synthetic_vk(&env));
    client.set_ct_token(&Address::generate(&env));

    let res = client.try_create_shipment(
        &merchant, &U256::from_u32(&env, 7), &token, &0i128,
        &vec![&env, 10_000u32], &ESCROW_DEADLINE, &Method::Courier,
        &Rail::Confidential, &None::<u32>, &None::<Address>,
    );
    assert_eq!(res, Err(Ok(Error::EscrowRequired)));
}

/// Confidential create with a non-zero amount → AmountInvalid: the registry
/// NEVER learns the real amount (it lives as a commitment on the CT token).
#[test]
fn ct_create_amount_must_be_zero() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, synthetic_vk(&env));
    client.set_ct_token(&Address::generate(&env));

    let res = client.try_create_shipment(
        &merchant, &U256::from_u32(&env, 7), &token, &AMOUNT,
        &vec![&env, 10_000u32], &ESCROW_DEADLINE, &Method::Courier,
        &Rail::Confidential, &None::<u32>, &Some(Address::generate(&env)),
    );
    assert_eq!(res, Err(Ok(Error::AmountInvalid)));
}

/// Confidential create with two milestones → BadMilestones: no amount ⇒ no
/// bps math ⇒ single milestone `[10_000]` only (§6.6 v0 constraint).
#[test]
fn ct_create_single_milestone_only() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, synthetic_vk(&env));
    client.set_ct_token(&Address::generate(&env));

    let res = client.try_create_shipment(
        &merchant, &U256::from_u32(&env, 7), &token, &0i128,
        &vec![&env, 3_333u32, 6_667u32], &ESCROW_DEADLINE, &Method::Courier,
        &Rail::Confidential, &None::<u32>, &Some(Address::generate(&env)),
    );
    assert_eq!(res, Err(Ok(Error::BadMilestones)));
}

/// One escrow account per shipment: reusing a mapped E → EscrowInUse;
/// a fresh E still works.
#[test]
fn ct_escrow_reuse_rejected() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, synthetic_vk(&env));
    client.set_ct_token(&Address::generate(&env));
    let c_s = U256::from_u32(&env, 7);

    let e = Address::generate(&env);
    let id = create_confidential(&env, &client, &token, &merchant, &c_s, &e);
    assert_eq!(id, 1);

    let res = client.try_create_shipment(
        &merchant, &c_s, &token, &0i128,
        &vec![&env, 10_000u32], &ESCROW_DEADLINE, &Method::Courier,
        &Rail::Confidential, &None::<u32>, &Some(e.clone()),
    );
    assert_eq!(res, Err(Ok(Error::EscrowInUse)));
    assert_eq!(client.escrow_of(&e), Some(id), "mapping untouched by the reject");

    let id2 =
        create_confidential(&env, &client, &token, &merchant, &c_s, &Address::generate(&env));
    assert_eq!(id2, 2);
}

/// Transparent create with `escrow = Some(_)` → EscrowUnexpected: the escrow
/// param belongs to the confidential rail only.
#[test]
fn transparent_rejects_escrow_param() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, synthetic_vk(&env));
    mint(&env, &token, &merchant, AMOUNT);

    let res = client.try_create_shipment(
        &merchant, &U256::from_u32(&env, 7), &token, &AMOUNT,
        &vec![&env, 10_000u32], &ESCROW_DEADLINE, &Method::Courier,
        &Rail::Transparent, &None::<u32>, &Some(Address::generate(&env)),
    );
    assert_eq!(res, Err(Ok(Error::EscrowUnexpected)));
}

/// escrow_of: unmapped → None; after create E → Some(id); other accounts
/// stay None.
#[test]
fn escrow_of_roundtrip() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, synthetic_vk(&env));
    client.set_ct_token(&Address::generate(&env));

    let e = Address::generate(&env);
    assert_eq!(client.escrow_of(&e), None, "unmapped account → None");

    let id =
        create_confidential(&env, &client, &token, &merchant, &U256::from_u32(&env, 7), &e);
    assert_eq!(client.escrow_of(&e), Some(id), "E → its shipment id");
    assert_eq!(
        client.escrow_of(&Address::generate(&env)),
        None,
        "other accounts unaffected"
    );
}

/// The full hook decision matrix. Unknown id → false (never panics);
/// Open/InTransit → false for everyone; after a full confidential lifecycle
/// driven with the delivery fixture (confidential shipment created FIRST so
/// it lands on the fixture-bound id 1) → true ONLY for (id, payout); after
/// refund_expired on a second confidential shipment → true ONLY for
/// (id2, merchant).
#[test]
fn release_allowed_matrix() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, test_fixtures::delivery_vk(&env));
    let fx = test_fixtures::valid_delivery(&env);
    client.set_ct_token(&Address::generate(&env));
    let stranger = Address::generate(&env);

    // Unknown id → false, never a panic.
    assert!(!client.release_allowed(&99u64, &stranger));

    // Confidential shipment FIRST so it gets the fixture-bound id 1.
    let e1 = Address::generate(&env);
    let id = create_confidential(&env, &client, &token, &merchant, &fx.c_s, &e1);
    assert_eq!(id, 1, "fixture binds shipment_id = 1");
    // Second confidential shipment for the refund leg.
    let e2 = Address::generate(&env);
    let id2 =
        create_confidential(&env, &client, &token, &merchant, &U256::from_u32(&env, 7), &e2);
    assert_eq!(id2, 2);

    // Open → false for everyone (merchant included).
    assert!(!client.release_allowed(&id, &merchant));
    assert!(!client.release_allowed(&id, &stranger));

    // Accept with the fixture's carrier_pk_commit at the pinned ledger ts.
    let carrier = Address::generate(&env);
    let payout = Address::generate(&env);
    client.accept(&id, &carrier, &payout, &fx.carrier_pk_commit);

    // InTransit → still false for everyone (payout included).
    assert!(!client.release_allowed(&id, &payout));
    assert!(!client.release_allowed(&id, &merchant));

    // Deliver with the real fixture proof at the pinned ledger time.
    env.ledger().set_timestamp(DELIVER_LEDGER_TS);
    client.deliver(&id, &fx.proof, &fx.nullifier, &fx.ts);
    assert_eq!(client.status(&id).state, State::Delivered);

    // Delivered → true ONLY for (id, payout).
    assert!(client.release_allowed(&id, &payout));
    assert!(!client.release_allowed(&id, &merchant));
    assert!(!client.release_allowed(&id, &carrier));
    assert!(!client.release_allowed(&id, &stranger));
    // ...and never leaks across shipments.
    assert!(!client.release_allowed(&id2, &payout));

    // Expire shipment 2 → true ONLY for (id2, merchant) — the refund address
    // is the stored merchant (DESIGN's refund_addr simplified).
    env.ledger().set_timestamp(ESCROW_DEADLINE + 1);
    client.refund_expired(&id2);
    assert_eq!(client.status(&id2).state, State::Expired);
    assert!(client.release_allowed(&id2, &merchant));
    assert!(!client.release_allowed(&id2, &payout));
    assert!(!client.release_allowed(&id2, &stranger));
    // Shipment 1's answer is unchanged by shipment 2's expiry.
    assert!(client.release_allowed(&id, &payout));
    assert!(!client.release_allowed(&id, &merchant));
}

/// Confidential deliver: proof verified and nullifier spent exactly like the
/// transparent rail, but ZERO token movement — the contract's balance is
/// unchanged and the payout receives NOTHING from the registry (settlement is
/// the hook-admitted confidential_transfer(E → payout) in a second tx,
/// §6.6 verify-then-settle).
#[test]
fn ct_deliver_no_transfer() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, test_fixtures::delivery_vk(&env));
    let fx = test_fixtures::valid_delivery(&env);
    client.set_ct_token(&Address::generate(&env));
    // Fund the merchant so any wrongful pull at create/deliver would show up.
    mint(&env, &token, &merchant, AMOUNT);

    let e = Address::generate(&env);
    let id = create_confidential(&env, &client, &token, &merchant, &fx.c_s, &e);
    assert_eq!(id, 1, "fixture binds shipment_id = 1");
    // No funds entered the registry at create.
    assert_eq!(balance(&env, &token, &client.address), 0);
    assert_eq!(balance(&env, &token, &merchant), AMOUNT);

    let carrier = Address::generate(&env);
    let payout = Address::generate(&env);
    client.accept(&id, &carrier, &payout, &fx.carrier_pk_commit);

    env.ledger().set_timestamp(DELIVER_LEDGER_TS);
    client.deliver(&id, &fx.proof, &fx.nullifier, &fx.ts);

    let st = client.status(&id);
    assert_eq!(st.state, State::Delivered);
    assert_eq!(st.paid, 0, "paid stays 0 on the confidential rail");
    assert_eq!(
        balance(&env, &token, &client.address),
        0,
        "contract token balance unchanged"
    );
    assert_eq!(
        balance(&env, &token, &payout),
        0,
        "payout received NOTHING from the registry"
    );
    assert_eq!(balance(&env, &token, &merchant), AMOUNT, "merchant untouched");

    // The nullifier is spent exactly as on the transparent rail (I5).
    let spent = env.as_contract(&client.address, || {
        env.storage()
            .persistent()
            .has(&DataKey::Null(fx.nullifier.clone()))
    });
    assert!(spent, "nullifier must be persisted as spent");
}
