//! Aegis confidential token — hook-caged escrow fork.
//!
//! Fork of the Confidential Token demo contract
//! (`brozorec/stellar-confidential-token-demo` @ `8b34def`, `contracts/token`)
//! wrapping OpenZeppelin's `ConfidentialToken` from `stellar-contracts`
//! branch `feat/confidential-verifier-ultrahonk` (validated @ `539968f`).
//! The single functional change vs upstream: `type Hooks = NoHooks` becomes
//! [`AegisEscrowHooks`], and the constructor additionally pins the
//! `aegis-registry` address.
//!
//! **Why:** per-shipment escrow accounts `E` hold their own keys, but key
//! possession must grant *proof-generation capability only, never spending
//! authority* (PIVOT guardrail 11). Hooks run after auth/decode and BEFORE
//! proof verification and balance updates, so a panicking hook aborts the op
//! and cannot be bypassed. For any `from` the registry maps as an escrow
//! (`escrow_of(from) == Some(id)`):
//!
//! * `on_withdraw` — always panics: escrow funds never exit to the public
//!   rail (threat T24).
//! * `on_transfer` — allowed iff `registry.release_allowed(id, to)`, i.e.
//!   `DELIVERED ⇒ to == payout` or `EXPIRED ⇒ to == refund_addr` (T23).
//! * `on_spender_transfer` / `on_set_spender` — always panic: escrows never
//!   delegate (closes every delegation movement path, guardrail 11).
//!
//! All other accounts pass through untouched. Independently of the escrow
//! map, `on_register` pins `auditor_id == 0` for every registration — the
//! approved-regulator policy.
//!
//! # ⚠️ Not Production Ready
//!
//! The UltraHonk verifier backend and the circuits the verification keys are
//! derived from are **unaudited**. Do not deploy anywhere handling real value.
#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, panic_with_error, symbol_short,
    Address, Bytes, Env, Symbol, Val,
};
// `ConfidentialAccount` / `SpenderDelegation` / `Bytes` are referenced by the
// default trait-method bodies that `#[contractimpl(contracttrait)]` generates
// for the read endpoints and the proof-carrying entry points, so they must be
// in scope here even though this file never names them directly.
use stellar_tokens::confidential::{
    storage as token_storage, ConfidentialAccount, ConfidentialToken, Hooks, SpenderDelegation,
};

#[cfg(test)]
mod test;

/// Instance-storage key for the pinned `aegis-registry` address.
const REGISTRY_KEY: Symbol = symbol_short!("REGISTRY");

/// Local declaration of the two `aegis-registry` views the hooks consult.
/// The registry implements exactly this interface (PIVOT §3.3).
#[contractclient(name = "RegistryClient")]
pub trait RegistryInterface {
    fn escrow_of(env: Env, escrow: Address) -> Option<u64>;
    fn release_allowed(env: Env, id: u64, to: Address) -> bool;
}

/// Hook-layer errors. Codes 43xx, disjoint from the upstream token's 35xx.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum AegisHookError {
    /// T24 — escrow funds can never exit to the public rail.
    EscrowWithdrawBlocked = 4301,
    /// T23 — transfer out of an escrow the registry has not released.
    EscrowReleaseNotAllowed = 4302,
    /// Escrows never delegate: spender-transfer from an escrow.
    EscrowSpenderBlocked = 4303,
    /// Approved-regulator policy: every account registers auditor_id 0.
    AuditorNotApproved = 4304,
    /// Escrows never delegate: set_spender by an escrow.
    EscrowDelegationBlocked = 4305,
}

/// The cage. See the crate docs for the rule table.
pub struct AegisEscrowHooks;

impl AegisEscrowHooks {
    /// The registry address pinned at construction.
    fn registry(e: &Env) -> Address {
        // Set in `__constructor`; the token is unusable without it.
        e.storage()
            .instance()
            .get(&REGISTRY_KEY)
            .expect("aegis-ct-token: registry address not set")
    }

    /// `Some(shipment_id)` iff `account` is a registry-mapped escrow.
    fn escrow_id(e: &Env, account: &Address) -> Option<u64> {
        RegistryClient::new(e, &Self::registry(e)).escrow_of(account)
    }
}

impl Hooks for AegisEscrowHooks {
    /// Approved-regulator policy: every registration (escrow or not) must
    /// commit to auditor key 0 — the mock-regulator Grumpkin key.
    fn on_register(e: &Env, _account: &Address, auditor_id: u32, _payload: Val) {
        if auditor_id != 0 {
            panic_with_error!(e, AegisHookError::AuditorNotApproved);
        }
    }

    /// T24: no exit to the public rail for escrows — unconditional.
    fn on_withdraw(e: &Env, from: &Address, _to: &Address, _amount: i128, _payload: Val) {
        if Self::escrow_id(e, from).is_some() {
            panic_with_error!(e, AegisHookError::EscrowWithdrawBlocked);
        }
    }

    /// T23: an escrow may transfer only to a destination the registry
    /// currently releases (`DELIVERED ⇒ payout`, `EXPIRED ⇒ refund_addr`).
    fn on_transfer(e: &Env, from: &Address, to: &Address, _payload: Val) {
        if let Some(id) = Self::escrow_id(e, from) {
            let allowed = RegistryClient::new(e, &Self::registry(e)).release_allowed(&id, to);
            if !allowed {
                panic_with_error!(e, AegisHookError::EscrowReleaseNotAllowed);
            }
        }
    }

    /// Escrows never delegate: no spender may move escrow funds.
    fn on_spender_transfer(
        e: &Env,
        _spender: &Address,
        from: &Address,
        _to: &Address,
        _payload: Val,
    ) {
        if Self::escrow_id(e, from).is_some() {
            panic_with_error!(e, AegisHookError::EscrowSpenderBlocked);
        }
    }

    /// Escrows never delegate: block the allowance-escrow path too, so no
    /// movement path exists that the hooks do not cover (guardrail 11).
    fn on_set_spender(
        e: &Env,
        account: &Address,
        _spender: &Address,
        _live_until_ledger: u32,
        _payload: Val,
    ) {
        if Self::escrow_id(e, account).is_some() {
            panic_with_error!(e, AegisHookError::EscrowDelegationBlocked);
        }
    }
}

#[contract]
pub struct AegisConfidentialToken;

#[contractimpl]
impl AegisConfidentialToken {
    /// Binds the underlying SEP-41 asset, the verifier registry, the auditor
    /// registry, and the `aegis-registry` whose escrow map the hooks enforce,
    /// then freezes the contract's address-as-field value used to
    /// domain-separate every account's viewing key.
    pub fn __constructor(
        e: &Env,
        underlying_asset: Address,
        verifier: Address,
        auditor: Address,
        registry: Address,
    ) {
        token_storage::set_underlying_asset(e, &underlying_asset);
        token_storage::set_verifier(e, &verifier);
        token_storage::set_auditor(e, &auditor);
        token_storage::set_address_as_field_element(e);
        e.storage().instance().set(&REGISTRY_KEY, &registry);
    }

    /// The pinned `aegis-registry` address (T25: registry and token pin each
    /// other; the carrier CLI cross-checks both pins in packet-verify).
    pub fn registry(e: &Env) -> Address {
        AegisEscrowHooks::registry(e)
    }
}

#[contractimpl(contracttrait)]
impl ConfidentialToken for AegisConfidentialToken {
    type Hooks = AegisEscrowHooks;
}
