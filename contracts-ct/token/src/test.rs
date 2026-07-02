//! Hook-layer tests for [`AegisEscrowHooks`], driven through the REAL token
//! entrypoints. Mirrors the approach of upstream's own suite
//! (`stellar-contracts` `packages/tokens/src/confidential/test.rs`): a mock
//! verifier that accepts every proof, on-curve Grumpkin fixture points, and
//! `data: Bytes` built by XDR-encoding the real payload structs. Hooks run
//! after auth/decode and BEFORE proof verification, so hook aborts are
//! observable without any real proofs, and hook pass-throughs complete the
//! full op under the mock verifier.
//!
//! The registry is a MINIMAL in-module mock implementing exactly the
//! `RegistryInterface` the hooks consult — no dependency on `aegis-registry`.

extern crate std;

use soroban_sdk::{
    contract, contractimpl, symbol_short, testutils::Address as _, token::StellarAssetClient,
    xdr::ToXdr, Address, Bytes, BytesN, Env, Error, InvokeError,
};
use stellar_tokens::confidential::{
    auditor::{storage as auditor_storage, ConfidentialAuditor},
    verifier::{CircuitType, ConfidentialVerifier},
    RegisterData, RegisterPayload, SetSpenderData, SetSpenderPayload, SpenderTransferData,
    SpenderTransferPayload, TransferData, TransferPayload, WithdrawData, WithdrawPayload,
};

use crate::{AegisConfidentialToken, AegisConfidentialTokenClient};

// ################## FIXTURES (as upstream's test.rs) ##################

/// Grumpkin generator `G = (1, Y)` — canonical on-curve fixture for auditor
/// and account keys.
const GRUMPKIN_G_BYTES: [u8; 64] = [
    // x = 1 (32-byte big-endian)
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
    // y (32-byte big-endian)
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xcf, 0x13, 0x5e, 0x75, 0x06, 0xa4, 0x5d, 0x63,
    0x2d, 0x27, 0x0d, 0x45, 0xf1, 0x18, 0x12, 0x94, 0x83, 0x3f, 0xc4, 0x8d, 0x82, 0x3f, 0x27, 0x2c,
];

fn fixture_point(e: &Env) -> BytesN<64> {
    BytesN::from_array(e, &GRUMPKIN_G_BYTES)
}

fn fixture_field(e: &Env, byte: u8) -> BytesN<32> {
    let mut bytes = [byte; 32];
    // Zero the top byte so the value stays below the BN254 scalar modulus,
    // keeping arbitrary sentinel bytes canonical for append_field/point.
    bytes[0] = 0;
    BytesN::from_array(e, &bytes)
}

fn register_data(e: &Env) -> Bytes {
    RegisterData {
        payload: RegisterPayload { y: fixture_point(e), pvk: fixture_point(e) },
        proof: Bytes::new(e),
    }
    .to_xdr(e)
}

fn withdraw_data(e: &Env) -> Bytes {
    WithdrawData {
        payload: WithdrawPayload {
            c_spend_new: fixture_point(e),
            b_tilde: fixture_field(e, 0xaa),
            r_e: fixture_point(e),
            sigma: fixture_field(e, 0xbb),
            b_aud_s: fixture_field(e, 0xcc),
        },
        proof: Bytes::new(e),
    }
    .to_xdr(e)
}

fn transfer_data(e: &Env) -> Bytes {
    TransferData {
        payload: TransferPayload {
            c_spend_new: fixture_point(e),
            c_tx: fixture_point(e),
            r_e: fixture_point(e),
            v_tilde: fixture_field(e, 0x11),
            b_tilde: fixture_field(e, 0x12),
            sigma: fixture_field(e, 0x13),
            v_aud_r: fixture_field(e, 0x14),
            r_aud_r: fixture_field(e, 0x15),
            v_aud_s: fixture_field(e, 0x16),
            b_aud_s: fixture_field(e, 0x17),
        },
        proof: Bytes::new(e),
    }
    .to_xdr(e)
}

fn set_spender_data(e: &Env) -> Bytes {
    SetSpenderData {
        payload: SetSpenderPayload {
            c_spend_new: fixture_point(e),
            c_a: fixture_point(e),
            escrowed_dvk: fixture_point(e),
            b_tilde: fixture_field(e, 0x21),
            a_tilde: fixture_field(e, 0x22),
            r_e: fixture_point(e),
            sigma: fixture_field(e, 0x23),
            sigma_a: fixture_field(e, 0x24),
            v_aud_s: fixture_field(e, 0x25),
            b_aud_s: fixture_field(e, 0x26),
        },
        proof: Bytes::new(e),
    }
    .to_xdr(e)
}

fn spender_transfer_data(e: &Env) -> Bytes {
    SpenderTransferData {
        payload: SpenderTransferPayload {
            c_a_new: fixture_point(e),
            c_tx: fixture_point(e),
            r_e: fixture_point(e),
            v_tilde: fixture_field(e, 0x31),
            a_tilde_new: fixture_field(e, 0x32),
            sigma_a_new: fixture_field(e, 0x33),
            v_aud_r: fixture_field(e, 0x34),
            r_aud_r: fixture_field(e, 0x35),
            v_aud_s: fixture_field(e, 0x36),
            a_aud_s: fixture_field(e, 0x37),
        },
        proof: Bytes::new(e),
    }
    .to_xdr(e)
}

// ################## MOCK CONTRACTS ##################

/// Accepts every proof — hooks run BEFORE verification, so hook aborts never
/// reach this; hook pass-throughs complete the op under it.
#[contract]
struct MockVerifier;

#[contractimpl(contracttrait)]
impl ConfidentialVerifier for MockVerifier {
    fn register_verification_key(_e: &Env, _ct: CircuitType, _vk: Bytes, _op: Address) {}

    fn update_verification_key(_e: &Env, _ct: CircuitType, _vk: Bytes, _op: Address) {}

    fn verify_proof(_e: &Env, _ct: CircuitType, _pi: Bytes, _proof: Bytes) -> bool {
        true
    }
}

#[contract]
struct MockAuditor;

#[contractimpl(contracttrait)]
impl ConfidentialAuditor for MockAuditor {
    fn register_key(e: &Env, auditor_id: u32, point: BytesN<64>, _operator: Address) {
        auditor_storage::register_key(e, auditor_id, &point);
    }

    fn rotate_key(e: &Env, auditor_id: u32, new_point: BytesN<64>, _operator: Address) {
        auditor_storage::rotate_key(e, auditor_id, &new_point);
    }
}

/// Minimal settable-map implementation of the exact `RegistryInterface` the
/// hooks declare: `escrow_of(escrow) -> Option<u64>`,
/// `release_allowed(id, to) -> bool` (default false).
#[contract]
struct MockRegistry;

#[contractimpl]
impl MockRegistry {
    pub fn set_escrow(e: &Env, escrow: Address, id: u64) {
        e.storage().instance().set(&(symbol_short!("esc"), escrow), &id);
    }

    pub fn set_release(e: &Env, id: u64, to: Address, allowed: bool) {
        e.storage().instance().set(&(symbol_short!("rel"), id, to), &allowed);
    }

    pub fn escrow_of(e: &Env, escrow: Address) -> Option<u64> {
        e.storage().instance().get(&(symbol_short!("esc"), escrow))
    }

    pub fn release_allowed(e: &Env, id: u64, to: Address) -> bool {
        e.storage().instance().get(&(symbol_short!("rel"), id, to)).unwrap_or(false)
    }
}

// ################## HARNESS ##################

struct Harness<'a> {
    e: Env,
    token: AegisConfidentialTokenClient<'a>,
    token_addr: Address,
    registry: MockRegistryClient<'a>,
    sac: StellarAssetClient<'a>,
}

fn setup<'a>() -> Harness<'a> {
    let e = Env::default();
    e.mock_all_auths();

    let sac_admin = Address::generate(&e);
    let sac = e.register_stellar_asset_contract_v2(sac_admin.clone());
    let sac_client = StellarAssetClient::new(&e, &sac.address());

    let verifier_addr = e.register(MockVerifier, ());
    let auditor_addr = e.register(MockAuditor, ());
    // Auditor id 0 = the approved-regulator key the on_register hook pins.
    MockAuditorClient::new(&e, &auditor_addr).register_key(
        &0u32,
        &fixture_point(&e),
        &Address::generate(&e),
    );

    let registry_addr = e.register(MockRegistry, ());
    let registry = MockRegistryClient::new(&e, &registry_addr);

    let token_addr = e.register(
        AegisConfidentialToken,
        (sac.address(), verifier_addr, auditor_addr, registry_addr.clone()),
    );
    let token = AegisConfidentialTokenClient::new(&e, &token_addr);
    assert_eq!(token.registry(), registry_addr);

    Harness { e, token, token_addr, registry, sac: sac_client }
}

/// Registers `account` with the pinned auditor_id 0.
fn register(h: &Harness, account: &Address) {
    h.token.register(account, &0u32, &register_data(&h.e));
}

/// The `Err` payload the try_ client returns when a hook aborts with
/// `AegisHookError` code `code`.
fn hook_err(code: u32) -> Result<Error, InvokeError> {
    Ok(Error::from_contract_error(code))
}

// ################## THREAT-TABLE TESTS ##################

/// T24: escrow-mapped `from` can never exit to the public rail; non-escrow
/// accounts pass the hook and the full withdraw succeeds.
#[test]
fn hook_withdraw_blocked() {
    let h = setup();
    let escrow = Address::generate(&h.e);
    let alice = Address::generate(&h.e);
    let dest = Address::generate(&h.e);
    register(&h, &escrow);
    register(&h, &alice);
    h.registry.set_escrow(&escrow, &7u64);
    // Fund the token contract so a passing withdraw's SEP-41 leg succeeds.
    h.sac.mint(&h.token_addr, &1_000i128);

    // Escrow: hook aborts with EscrowWithdrawBlocked before verification.
    let res = h.token.try_withdraw(&escrow, &dest, &5i128, &withdraw_data(&h.e));
    assert_eq!(res.err().unwrap(), hook_err(4301));

    // Non-escrow: passes untouched, full op completes.
    h.token.withdraw(&alice, &dest, &5i128, &withdraw_data(&h.e));
}

/// T23: release_allowed=false (nothing released yet) ⇒ transfer out of the
/// escrow aborts — the packet-key holder cannot settle early.
#[test]
fn hook_premature_release() {
    let h = setup();
    let escrow = Address::generate(&h.e);
    let payout = Address::generate(&h.e);
    register(&h, &escrow);
    register(&h, &payout);
    h.registry.set_escrow(&escrow, &7u64);
    // No set_release: registry releases nothing for shipment 7.

    let res = h.token.try_confidential_transfer(&escrow, &payout, &transfer_data(&h.e));
    assert_eq!(res.err().unwrap(), hook_err(4302));
}

/// T23: release_allowed only for the stored payout ⇒ E→other aborts,
/// E→payout passes the hook and the full (mock-verified) transfer succeeds.
#[test]
fn hook_wrong_dest() {
    let h = setup();
    let escrow = Address::generate(&h.e);
    let payout = Address::generate(&h.e);
    let other = Address::generate(&h.e);
    register(&h, &escrow);
    register(&h, &payout);
    register(&h, &other);
    h.registry.set_escrow(&escrow, &7u64);
    h.registry.set_release(&7u64, &payout, &true);

    let res = h.token.try_confidential_transfer(&escrow, &other, &transfer_data(&h.e));
    assert_eq!(res.err().unwrap(), hook_err(4302));

    h.token.confidential_transfer(&escrow, &payout, &transfer_data(&h.e));
}

/// Escrows never delegate: spender-transfer with from=E aborts even for a
/// released destination, and E cannot even create a delegation.
#[test]
fn hook_spender_blocked() {
    let h = setup();
    let escrow = Address::generate(&h.e);
    let spender = Address::generate(&h.e);
    let dest = Address::generate(&h.e);
    register(&h, &escrow);
    register(&h, &spender);
    register(&h, &dest);
    h.registry.set_escrow(&escrow, &7u64);
    h.registry.set_release(&7u64, &dest, &true);

    // Hook runs before the delegation-exists check, so no set_spender needed.
    let res = h.token.try_confidential_transfer_from(
        &spender,
        &escrow,
        &dest,
        &spender_transfer_data(&h.e),
    );
    assert_eq!(res.err().unwrap(), hook_err(4303));

    // Guardrail 11: the allowance-escrow path is closed too.
    let live_until = h.e.ledger().sequence() + 100;
    let res =
        h.token.try_set_spender(&escrow, &spender, &live_until, &set_spender_data(&h.e));
    assert_eq!(res.err().unwrap(), hook_err(4305));
}

/// Approved-regulator policy: auditor_id != 0 aborts for EVERY registration;
/// auditor_id == 0 passes.
#[test]
fn register_auditor_pinned() {
    let h = setup();
    let bad = Address::generate(&h.e);
    let good = Address::generate(&h.e);

    let res = h.token.try_register(&bad, &1u32, &register_data(&h.e));
    assert_eq!(res.err().unwrap(), hook_err(4304));

    h.token.register(&good, &0u32, &register_data(&h.e));
    assert_eq!(h.token.confidential_balance(&good).auditor_id, 0u32);
}

/// Accounts the registry does not map are untouched by every hook: the whole
/// lifecycle (deposit, merge, transfer, withdraw, delegate, spender-transfer)
/// runs through the real entrypoints without interference.
#[test]
fn non_escrow_untouched() {
    let h = setup();
    let merchant = Address::generate(&h.e);
    let alice = Address::generate(&h.e);
    let bob = Address::generate(&h.e);
    let dest = Address::generate(&h.e);
    register(&h, &alice);
    register(&h, &bob);
    h.sac.mint(&merchant, &1_000i128);

    // on_deposit no-op (public-amount SEP-41 leg moves 100 into the token).
    h.token.deposit(&merchant, &alice, &100i128);
    // on_merge no-op.
    h.token.merge(&alice);
    // on_transfer no-op for unmapped `from`.
    h.token.confidential_transfer(&alice, &bob, &transfer_data(&h.e));
    // on_withdraw no-op for unmapped `from`.
    h.token.withdraw(&alice, &dest, &50i128, &withdraw_data(&h.e));
    // on_set_spender / on_spender_transfer no-ops for unmapped accounts.
    let live_until = h.e.ledger().sequence() + 100;
    h.token.set_spender(&alice, &bob, &live_until, &set_spender_data(&h.e));
    // Recipient must itself be a registered confidential account — reuse bob.
    h.token.confidential_transfer_from(&bob, &alice, &bob, &spender_transfer_data(&h.e));
}
