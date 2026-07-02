#![no_std]

//! `aegis-registry` — core settlement contract of Aegis Relay.
//!
//! Holds the escrow, runs the shipment lifecycle state machine (DESIGN.md §7)
//! and settles delivery atomically against a Groth16 proof (circuit A1)
//! verified via the CAP-0074 host functions.
//!
//! Non-negotiable invariants implemented here (DESIGN.md §10.2):
//! - **I1** — `C_S`/`head` in public inputs come from *storage*, never args.
//! - **I3** — payout is write-once at `accept`; `deliver` is permissionless.
//! - **I4** — every entrypoint asserts its legal predecessor state.
//! - **I5** — nullifier map is persistent, check-then-set in one invocation,
//!   TTL bumped on every touch.
//! - **I6** — VKs are set in the constructor and immutable forever (no setter).
//! - **I7** — milestone bps sum to exactly 10 000; final milestone gets
//!   `amount − Σ paid` so rounding dust cannot strand.
//! - **I8** — checks → effects → interactions: state written before transfers.
//! - **I9** — freshness windows enforced on-chain (`WINDOW_SEC`, `accept_ts`).
//! - **I10** — events are opaque: ids, method enum, nullifier only.

pub mod groth16;

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_fixtures;
#[cfg(test)]
mod test_fixtures_flight;

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype,
    crypto::bn254::Bn254Fr, token::TokenClient, vec, Address, Env, U256, Vec,
};

/// TTL bump applied on every persistent/instance write (in ledgers).
/// Same constants as the v1 donor contract: threshold 100k, extend to 500k
/// (~29 days at ~5 s/ledger) — comfortably past any escrow horizon in the
/// demo window. Fail-closed archival semantics make eviction safe (I5), the
/// bumps keep the happy path from ever hitting restoration.
const TTL_THRESHOLD: u32 = 100_000;
const TTL_EXTEND_TO: u32 = 500_000;

/// Milestone shares are denominated in basis points and must sum to this.
const BPS_TOTAL: u64 = 10_000;

// ── Types ─────────────────────────────────────────────────────────────────────

/// Delivery method (DESIGN.md §11). Matches `aegis_common::METHOD_*`.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Method {
    Courier = 1,
    Locker = 2,
    Drone = 3,
}

/// Escrow rail (DESIGN.md §6.6). `Transparent` escrows funds in this
/// contract. `Confidential` (rung R3) holds them in a hook-caged escrow
/// account `E` on the hooked OZ confidential token: no funds ever enter the
/// registry — it stores only state and adjudicates movement via the
/// `escrow_of` / `release_allowed` views that the token's hooks cross-call.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Rail {
    Transparent = 0,
    Confidential = 1,
}

/// On-chain-transacting roles (DESIGN.md §3). Only these two act on the
/// registry: merchant via `create_shipment`, carrier via `accept`. Recipient
/// and auditor never transact here, so they are not bound on-chain.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Role {
    Merchant = 0,
    Carrier = 1,
}

/// Lifecycle state (DESIGN.md §7). Transitions are the only mutators and
/// every entrypoint asserts its legal predecessor state(s) (I4).
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum State {
    Open = 0,
    InTransit = 1,
    Delivered = 2,
    Expired = 3,
}

/// The stored shipment record. All fields are already opaque or public by
/// design (§13), so `status()` returns the record as-is.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Shipment {
    /// Opaque shipment commitment (12-ary Poseidon, computed off-chain).
    pub c_s: U256,
    pub state: State,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
    /// Milestone shares in bps; len 1 or 2, each > 0, Σ == 10 000 (I7).
    pub milestones: Vec<u32>,
    /// Total already paid out to the carrier.
    pub paid: i128,
    /// Coarse public deadline for the permissionless refund path.
    pub escrow_deadline: u64,
    pub method: Method,
    pub rail: Rail,
    pub lane_id: Option<u32>,
    /// Write-once at `accept` (I3) — never reassigned anywhere.
    pub carrier: Option<Address>,
    /// Write-once at `accept` (I3) — `deliver` pays only this address.
    pub payout: Option<Address>,
    pub carrier_pk_commit: Option<U256>,
    /// Custody head, computed on-chain at `accept` (DESIGN.md §6.2).
    pub head: Option<U256>,
    pub accept_ts: u64,
    /// Set by `submit_flight` (later task). While it stays `false`,
    /// `method == Drone` shipments are undeliverable — correct for this build.
    pub flight_ok: bool,
}

#[contracttype]
pub enum DataKey {
    Admin,
    VkDelivery,
    VkFlight,
    Credentials,
    Airspace,
    Counter,
    Ship(u64),
    Null(U256),
    /// Confidential-rail escrow account `E` → shipment id (persistent,
    /// TTL-bumped on write — DESIGN.md §6.6).
    Escrow(Address),
    /// Address of the hooked OZ confidential token (instance, set-once via
    /// `set_ct_token`).
    CtToken,
    /// Wallet → its currently bound role (persistent, TTL-bumped).
    Role(Address),
    /// Wallet → count of non-terminal services it is rendering in its bound
    /// role. Switching roles is only allowed at 0 (persistent, TTL-bumped).
    Active(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    /// The Groth16 proof did not verify against the storage-derived signals.
    BadProof = 1,
    /// The shipment is not in a legal predecessor state for this entrypoint.
    WrongState = 2,
    /// `|ledger_time − ts| > WINDOW_SEC` (I9).
    StaleTs = 3,
    /// `ts <= accept_ts` (I9).
    TsBeforeAccept = 4,
    /// The nullifier has already been spent (I5).
    NullifierSpent = 5,
    /// Reserved: action attempted after `escrow_deadline`.
    DeadlinePassed = 6,
    /// `refund_expired` called at or before `escrow_deadline`.
    DeadlineNotPassed = 7,
    /// Milestones not len 1–2 / contain a zero share / Σ != 10 000 (I7).
    BadMilestones = 8,
    /// Retired: the confidential rail is supported since the §6.6 escrow-map
    /// build. Kept so the error-code numbering stays stable; never returned.
    RailUnsupported = 9,
    /// `method == Drone` requires a verified flight before `deliver` (I4).
    FlightRequired = 10,
    /// No shipment stored under this id.
    NotFound = 11,
    /// `amount <= 0`.
    AmountInvalid = 12,
    /// `escrow_deadline` not in the future.
    DeadlineInvalid = 13,
    /// `submit_flight` called on a shipment whose `method != Drone` (I4).
    NotDrone = 14,
    /// `submit_flight` on a Drone shipment with no `lane_id` — no corridor to
    /// check against.
    NoLane = 15,
    /// The stored corridor's validity window does not cover the current ledger
    /// time (I1/T22 — window enforced by the registry, not the airspace store).
    CorridorExpired = 16,
    /// No flight VK was configured at construction — Drone flights cannot be
    /// verified on this deployment (I6).
    VkMissing = 17,
    /// `set_ct_token` called when the CT token address is already set
    /// (set-once by construction — §6.6 mutual address pinning).
    AlreadySet = 18,
    /// `escrow` must be `None` on the transparent rail.
    EscrowUnexpected = 19,
    /// Confidential create attempted before `set_ct_token` wired the hooked
    /// token's address.
    CtTokenUnset = 20,
    /// Confidential create requires `escrow = Some(E)`.
    EscrowRequired = 21,
    /// The escrow account is already mapped to a shipment (one `E` per
    /// shipment, never reused).
    EscrowInUse = 22,
    /// The wallet is bound to a different role and still has active services in
    /// it — it cannot act in this role until those services reach a terminal
    /// state. (One role per wallet at a time.)
    WrongRole = 23,
    /// `set_role` attempted a role switch while the wallet still has active
    /// services — switch only when idle.
    RoleLocked = 24,
}

// ── Events (opaque by design — I10) ───────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShipmentCreated {
    #[topic]
    pub id: u64,
    pub method: Method,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShipmentAccepted {
    #[topic]
    pub id: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShipmentDelivered {
    #[topic]
    pub id: u64,
    pub nullifier: U256,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShipmentExpired {
    #[topic]
    pub id: u64,
}

/// Emitted when a Drone shipment's flight proof verifies (I10 — id only).
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FlightVerified {
    #[topic]
    pub id: u64,
}

// ── Airspace cross-contract client ─────────────────────────────────────────────
// Corridor roots/windows are read from the companion `aegis-airspace` contract's
// storage, never from tx args (I1/T22). `CorridorInfo` mirrors the airspace
// contract's type field-for-field so the returned value decodes cleanly.
mod airspace_client {
    use soroban_sdk::{contractclient, contracttype, Env, U256};

    #[contracttype]
    #[derive(Clone)]
    pub struct CorridorInfo {
        pub root: U256,
        pub valid_from: u64,
        pub valid_to: u64,
    }

    #[contractclient(name = "AirspaceClient")]
    #[allow(dead_code)] // only the generated `AirspaceClient` is called directly
    pub trait AirspaceInterface {
        fn corridor(env: Env, lane_id: u32) -> CorridorInfo;
    }
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct RegistryContract;

#[contractimpl]
impl RegistryContract {
    /// Initialise the registry. VKs are immutable forever (I6): there is no
    /// setter — a new circuit means a new deployment.
    ///
    /// `vk_flight` is optional so the delivery-only build can deploy before
    /// the flight circuit's ceremony exists.
    pub fn __constructor(
        env: Env,
        admin: Address,
        vk_delivery: groth16::VerificationKey,
        vk_flight: Option<groth16::VerificationKey>,
        credentials: Address,
        airspace: Address,
    ) {
        let inst = env.storage().instance();
        inst.set(&DataKey::Admin, &admin);
        inst.set(&DataKey::VkDelivery, &vk_delivery);
        inst.set(&DataKey::VkFlight, &vk_flight);
        inst.set(&DataKey::Credentials, &credentials);
        inst.set(&DataKey::Airspace, &airspace);
        inst.set(&DataKey::Counter, &0u64);
        inst.extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    /// Read a wallet's active-service count (0 if unset).
    fn active_of(env: &Env, addr: &Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Active(addr.clone()))
            .unwrap_or(0)
    }

    fn set_active(env: &Env, addr: &Address, n: u32) {
        let key = DataKey::Active(addr.clone());
        env.storage().persistent().set(&key, &n);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    /// Bind `addr` to `want`, or confirm it is already `want`. If it is bound to
    /// a DIFFERENT role, allow the switch only when the wallet is idle
    /// (`active == 0`); otherwise reject with `WrongRole`. Returns Ok on bind.
    fn bind_role(env: &Env, addr: &Address, want: Role) -> Result<(), Error> {
        let rkey = DataKey::Role(addr.clone());
        let current: Option<Role> = env.storage().persistent().get(&rkey);
        match current {
            Some(r) if r == want => Ok(()),
            None => {
                env.storage().persistent().set(&rkey, &want);
                env.storage()
                    .persistent()
                    .extend_ttl(&rkey, TTL_THRESHOLD, TTL_EXTEND_TO);
                Ok(())
            }
            Some(_) => {
                if Self::active_of(env, addr) == 0 {
                    env.storage().persistent().set(&rkey, &want);
                    env.storage()
                        .persistent()
                        .extend_ttl(&rkey, TTL_THRESHOLD, TTL_EXTEND_TO);
                    Ok(())
                } else {
                    Err(Error::WrongRole)
                }
            }
        }
    }

    /// Increment a wallet's active-service count.
    fn inc_active(env: &Env, addr: &Address) {
        let n = Self::active_of(env, addr).saturating_add(1);
        Self::set_active(env, addr, n);
    }

    /// Decrement a wallet's active-service count (saturating at 0).
    fn dec_active(env: &Env, addr: &Address) {
        let n = Self::active_of(env, addr).saturating_sub(1);
        Self::set_active(env, addr, n);
    }

    /// Wire the hooked OZ confidential token's address (DESIGN.md §6.6).
    ///
    /// Set-once by construction: this setter exists (instead of a
    /// constructor arg) only because registry and token need each other's
    /// addresses — deploy the registry first, construct the token with the
    /// registry's address, then `set_ct_token` closes the loop. `AlreadySet`
    /// makes the pin immutable afterwards, mirroring I6's no-mutation stance.
    pub fn set_ct_token(env: Env, token: Address) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if env.storage().instance().has(&DataKey::CtToken) {
            return Err(Error::AlreadySet);
        }
        env.storage().instance().set(&DataKey::CtToken, &token);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(())
    }

    /// The pinned CT token address, if `set_ct_token` has run.
    pub fn ct_token(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::CtToken)
    }

    /// Create a shipment. Transparent rail: escrow `amount` of `token` in
    /// the contract. Confidential rail (DESIGN.md §6.6): NO funds enter the
    /// registry — a hook-caged escrow account `E` on the CT token holds the
    /// (hidden) amount, and this call only records `Escrow(E) = id`.
    ///
    /// Steps:
    ///   0. `merchant.require_auth()` — before any state touch.
    ///   1. Validate (both rails): `escrow_deadline` in the future;
    ///      milestones len 1–2, each > 0, Σ == 10 000 exactly (I7).
    ///      Transparent: `escrow == None`; `amount > 0`.
    ///      Confidential: CT token wired (`set_ct_token`); `escrow = Some(E)`
    ///      with `E` not already mapped; `amount == 0` — the registry NEVER
    ///      learns the real amount (it lives as a commitment on the CT
    ///      token); milestones exactly `[10 000]` (no bps math without an
    ///      amount — §6.6 v0 constraint).
    ///   2. Allocate the next sequential id (first shipment is 1) and store
    ///      the record — plus `Escrow(E) = id` on the confidential rail
    ///      (state before interaction — I8).
    ///   3. Transparent only: pull the escrow in,
    ///      `token.transfer(merchant → contract)`.
    ///   4. Emit opaque `ShipmentCreated { id, method }` (I10).
    pub fn create_shipment(
        env: Env,
        merchant: Address,
        c_s: U256,
        token: Address,
        amount: i128,
        milestones: Vec<u32>,
        escrow_deadline: u64,
        method: Method,
        rail: Rail,
        lane_id: Option<u32>,
        escrow: Option<Address>,
    ) -> Result<u64, Error> {
        // 0. Auth first.
        merchant.require_auth();

        // 1. Validation. Transparent-rail checks keep their original order
        //    so existing behavior is unchanged.
        if rail == Rail::Transparent {
            if escrow.is_some() {
                return Err(Error::EscrowUnexpected);
            }
            if amount <= 0 {
                return Err(Error::AmountInvalid);
            }
        }
        if escrow_deadline <= env.ledger().timestamp() {
            return Err(Error::DeadlineInvalid);
        }
        let n = milestones.len();
        if n == 0 || n > 2 {
            return Err(Error::BadMilestones);
        }
        let mut sum: u64 = 0;
        for m in milestones.iter() {
            if m == 0 {
                return Err(Error::BadMilestones);
            }
            sum += m as u64;
        }
        if sum != BPS_TOTAL {
            return Err(Error::BadMilestones);
        }
        if rail == Rail::Confidential {
            // §6.6: the hooks are only meaningful on a token that pins this
            // registry — refuse to create escrows before the mutual pin.
            if !env.storage().instance().has(&DataKey::CtToken) {
                return Err(Error::CtTokenUnset);
            }
            let e = match &escrow {
                Some(e) => e.clone(),
                None => return Err(Error::EscrowRequired),
            };
            // The registry NEVER learns the real amount: it must be pinned
            // to 0 so `deliver`/`refund_expired` provably move nothing.
            if amount != 0 {
                return Err(Error::AmountInvalid);
            }
            // No amount ⇒ no bps math: single milestone [10 000] only
            // (the Σ == 10 000 check above forces the value for len 1).
            if milestones.len() != 1 {
                return Err(Error::BadMilestones);
            }
            // One escrow account per shipment, never reused.
            if env.storage().persistent().has(&DataKey::Escrow(e)) {
                return Err(Error::EscrowInUse);
            }
        }

        // 2. Allocate id (counter starts at 1) and store the record.
        let id: u64 = env
            .storage()
            .instance()
            .get::<_, u64>(&DataKey::Counter)
            .unwrap_or(0)
            + 1;
        env.storage().instance().set(&DataKey::Counter, &id);

        // Role binding: the creator acts as Merchant. Rejects if the wallet is
        // an active Carrier (WrongRole); auto-binds/auto-switches when idle.
        Self::bind_role(&env, &merchant, Role::Merchant)?;
        Self::inc_active(&env, &merchant);

        let shipment = Shipment {
            c_s,
            state: State::Open,
            merchant: merchant.clone(),
            token: token.clone(),
            amount,
            milestones,
            paid: 0,
            escrow_deadline,
            method,
            rail,
            lane_id,
            carrier: None,
            payout: None,
            carrier_pk_commit: None,
            head: None,
            accept_ts: 0,
            flight_ok: false,
        };
        let key = DataKey::Ship(id);
        env.storage().persistent().set(&key, &shipment);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        // Confidential rail: record the escrow-account → id mapping the CT
        // token's hooks resolve via `escrow_of` (§6.6). `Some(escrow)` here
        // implies `rail == Confidential` — Transparent + Some was rejected
        // above with EscrowUnexpected.
        if let Some(e) = &escrow {
            let ekey = DataKey::Escrow(e.clone());
            env.storage().persistent().set(&ekey, &id);
            env.storage()
                .persistent()
                .extend_ttl(&ekey, TTL_THRESHOLD, TTL_EXTEND_TO);
        }
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        // 3. Escrow in — after all validation and after the state write.
        //    Transparent rail ONLY: on the confidential rail no funds enter
        //    the registry (the caged account E on the CT token holds them).
        if rail == Rail::Transparent {
            TokenClient::new(&env, &token).transfer(
                &merchant,
                &env.current_contract_address(),
                &amount,
            );
        }

        // 4. Opaque event (I10): id + method, nothing else.
        ShipmentCreated { id, method }.publish(&env);

        Ok(id)
    }

    /// Carrier takes custody: `Open → InTransit`.
    ///
    /// Steps:
    ///   0. `carrier.require_auth()` — before any state touch.
    ///   1. State must be `Open` (I4).
    ///   2. Store carrier / payout / `carrier_pk_commit` — write-once by
    ///      construction, never reassigned anywhere (I3). Compute
    ///      `head = poseidon2(poseidon2(DOM_ACCEPT, id), carrier_pk_commit)`
    ///      on-chain (DESIGN.md §6.2) and record `accept_ts`.
    ///   3. Two-milestone vectors release milestone 0 now:
    ///      `pay0 = amount · bps₀ / 10 000` (integer floor — I7), transferred
    ///      *after* the state write (I8).
    ///   4. Emit `ShipmentAccepted { id }`.
    pub fn accept(
        env: Env,
        id: u64,
        carrier: Address,
        payout: Address,
        carrier_pk_commit: U256,
    ) -> Result<(), Error> {
        // 0. Auth first.
        carrier.require_auth();

        let key = DataKey::Ship(id);
        let mut s: Shipment = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;

        // 1. Legal predecessor state (I4).
        if s.state != State::Open {
            return Err(Error::WrongState);
        }

        // Role binding: the acceptor acts as Carrier. Rejects if the wallet is
        // an active Merchant (WrongRole); auto-binds/auto-switches when idle.
        Self::bind_role(&env, &carrier, Role::Carrier)?;
        Self::inc_active(&env, &carrier);

        // 2. Effects: custody fields, write-once (I3).
        s.state = State::InTransit;
        s.carrier = Some(carrier);
        s.payout = Some(payout.clone());
        s.head = Some(aegis_common::custody_head(&env, id, &carrier_pk_commit));
        s.carrier_pk_commit = Some(carrier_pk_commit);
        s.accept_ts = env.ledger().timestamp();

        // 3. Pickup milestone (two-milestone vectors only).
        let mut pay0: i128 = 0;
        if s.milestones.len() == 2 {
            pay0 = s.amount * s.milestones.get_unchecked(0) as i128 / BPS_TOTAL as i128;
            s.paid += pay0;
        }

        let token = s.token.clone();
        env.storage().persistent().set(&key, &s);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        // Interaction after effects (I8).
        if pay0 > 0 {
            TokenClient::new(&env, &token).transfer(
                &env.current_contract_address(),
                &payout,
                &pay0,
            );
        }

        ShipmentAccepted { id }.publish(&env);

        Ok(())
    }

    /// Settle delivery against a Groth16 A1 proof: `InTransit → Delivered`.
    ///
    /// Deliberately **no `require_auth`** — permissionless submission is safe
    /// because funds only ever flow to the payout stored at `accept` (I3);
    /// a front-runner merely donates the fee (T3).
    ///
    /// Checks, in order:
    ///   1. State == `InTransit` (I4).
    ///   2. `method == Drone` requires `flight_ok` (I4) — impossible in this
    ///      build (no `submit_flight` yet), so Drone is undeliverable.
    ///   3. Freshness (I9): `|ledger_time − ts| ≤ WINDOW_SEC`, `ts > accept_ts`.
    ///   4. Nullifier unspent (I5).
    ///   5. Groth16 verify with public signals built **from storage** (I1):
    ///      `[shipment_id, C_S, head, nullifier, ts]` — `C_S`/`head` are the
    ///      stored values, never caller-supplied.
    /// Effects before interaction (I8): nullifier marked spent (check-then-set
    /// in this same invocation), state → `Delivered`, `paid = amount`; then
    /// the remaining escrow is transferred to the **stored** payout.
    ///
    /// Confidential rail (§6.6): all checks and the proof verification are
    /// IDENTICAL, but the payout transfer is skipped — `amount == 0` by
    /// construction so `remaining == 0` and `paid` stays 0. Settlement is
    /// the hook-admitted `confidential_transfer(E → payout)` in a second tx
    /// (verify-then-settle). Event unchanged.
    pub fn deliver(
        env: Env,
        id: u64,
        proof: groth16::Proof,
        nullifier: U256,
        ts: u64,
    ) -> Result<(), Error> {
        let key = DataKey::Ship(id);
        let mut s: Shipment = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;

        // 1. Legal predecessor state (I4).
        if s.state != State::InTransit {
            return Err(Error::WrongState);
        }

        // 2. Drone shipments need a verified flight first (I4).
        if s.method == Method::Drone && !s.flight_ok {
            return Err(Error::FlightRequired);
        }

        // 3. Freshness window, on-chain (I9).
        let now = env.ledger().timestamp();
        let drift = if now >= ts { now - ts } else { ts - now };
        if drift > aegis_common::WINDOW_SEC {
            return Err(Error::StaleTs);
        }
        if ts <= s.accept_ts {
            return Err(Error::TsBeforeAccept);
        }

        // 4. Nullifier must be fresh (I5 — checked and set in this invocation).
        let null_key = DataKey::Null(nullifier.clone());
        if env.storage().persistent().has(&null_key) {
            return Err(Error::NullifierSpent);
        }

        // 5. Public signals from STORAGE (I1), in circuit order:
        //    [shipment_id, C_S, head, nullifier, ts].
        let head = s.head.clone().ok_or(Error::WrongState)?;
        let signals: Vec<Bn254Fr> = vec![
            &env,
            Bn254Fr::from(aegis_common::fr_u64(&env, id)),
            Bn254Fr::from(s.c_s.clone()),
            Bn254Fr::from(head),
            Bn254Fr::from(nullifier.clone()),
            Bn254Fr::from(aegis_common::fr_u64(&env, ts)),
        ];
        let vk: groth16::VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::VkDelivery)
            .unwrap();
        if !groth16::verify(&env, &vk, &proof, signals) {
            return Err(Error::BadProof);
        }

        // Effects (I8): spend nullifier, advance state, then interact.
        env.storage().persistent().set(&null_key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&null_key, TTL_THRESHOLD, TTL_EXTEND_TO);

        s.state = State::Delivered;
        // Service complete: free both wallets' active counts so they may switch
        // roles. carrier is Some here (state was InTransit).
        Self::dec_active(&env, &s.merchant);
        if let Some(c) = &s.carrier {
            Self::dec_active(&env, c);
        }
        let remaining = s.amount - s.paid;
        s.paid = s.amount;
        let payout = s.payout.clone().ok_or(Error::WrongState)?;
        let token = s.token.clone();
        env.storage().persistent().set(&key, &s);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        // Interaction: final milestone gets amount − Σ paid (I7 — no dust).
        // Confidential rail: amount == 0 ⇒ remaining == 0 ⇒ no transfer here;
        // the hook-admitted confidential_transfer(E → payout) settles in a
        // second tx (§6.6 verify-then-settle).
        if remaining > 0 {
            TokenClient::new(&env, &token).transfer(
                &env.current_contract_address(),
                &payout,
                &remaining,
            );
        }

        ShipmentDelivered { id, nullifier }.publish(&env);

        Ok(())
    }

    /// Verify a drone flight (circuit A2) and set `flight_ok`, the gate that
    /// unlocks `deliver` for `method == Drone` (I4).
    ///
    /// Permissionless like `deliver` (I3 reasoning): a flight proof moves no
    /// funds, so the submitter is irrelevant — a front-runner merely donates
    /// the fee (T3).
    ///
    /// Checks, in order:
    ///   1. State == `InTransit` (I4); `method == Drone`; `flight_ok == false`
    ///      (no re-submission — a second flight is a WrongState no-op).
    ///   2. Freshness (I9): `|ledger_time − t_n| ≤ WINDOW_SEC`,
    ///      `t_0 ≥ accept_ts`, `t_0 ≤ t_n`.
    ///   3. A `lane_id` must be set — it names the corridor to check against.
    ///   4. Corridor root + window come from the **airspace contract's**
    ///      storage (I1/T22), never from the caller: a cross-contract
    ///      `corridor(lane)` read, then `valid_from ≤ now ≤ valid_to`.
    ///   5. The flight VK must have been configured at construction (I6).
    ///   6. Groth16 verify with public signals built **from storage** (I1),
    ///      in circuit A2 order:
    ///      `[shipment_id, C_S, head, corridor_root, t_0, t_n]` — only `t_0`/`t_n`
    ///      are caller-supplied, and the proof binds them.
    ///   7. Effect (I8 — state write, no interaction): `flight_ok = true`,
    ///      TTL bumps, opaque `FlightVerified { id }` (I10).
    pub fn submit_flight(
        env: Env,
        id: u64,
        proof: groth16::Proof,
        t_0: u64,
        t_n: u64,
    ) -> Result<(), Error> {
        let key = DataKey::Ship(id);
        let mut s: Shipment = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;

        // 1. Legal predecessor state + Drone gating (I4).
        if s.state != State::InTransit {
            return Err(Error::WrongState);
        }
        if s.method != Method::Drone {
            return Err(Error::NotDrone);
        }
        if s.flight_ok {
            // Already verified — no re-submission.
            return Err(Error::WrongState);
        }

        // 2. Freshness window, on-chain (I9). Circuits cannot see the clock.
        let now = env.ledger().timestamp();
        let drift = if now >= t_n { now - t_n } else { t_n - now };
        if drift > aegis_common::WINDOW_SEC {
            return Err(Error::StaleTs);
        }
        if t_0 < s.accept_ts {
            return Err(Error::TsBeforeAccept);
        }
        if t_0 > t_n {
            return Err(Error::StaleTs);
        }

        // 3. A lane is required to know which corridor to check.
        let lane = s.lane_id.ok_or(Error::NoLane)?;

        // 4. Corridor root/window from the AIRSPACE contract's storage (I1/T22).
        //    Never trust a caller-supplied root — that is a forged universe.
        let airspace_addr: Address =
            env.storage().instance().get(&DataKey::Airspace).unwrap();
        let corridor =
            airspace_client::AirspaceClient::new(&env, &airspace_addr).corridor(&lane);
        if now < corridor.valid_from || now > corridor.valid_to {
            return Err(Error::CorridorExpired);
        }

        // 5. Flight VK must be configured (I6 — set once, never mutated).
        let vk: groth16::VerificationKey = env
            .storage()
            .instance()
            .get::<_, Option<groth16::VerificationKey>>(&DataKey::VkFlight)
            .unwrap()
            .ok_or(Error::VkMissing)?;

        // 6. Public signals from STORAGE (I1), in circuit A2 order:
        //    [shipment_id, C_S, head, corridor_root, t_0, t_n].
        let head = s.head.clone().ok_or(Error::WrongState)?;
        let signals: Vec<Bn254Fr> = vec![
            &env,
            Bn254Fr::from(aegis_common::fr_u64(&env, id)),
            Bn254Fr::from(s.c_s.clone()),
            Bn254Fr::from(head),
            Bn254Fr::from(corridor.root.clone()),
            Bn254Fr::from(aegis_common::fr_u64(&env, t_0)),
            Bn254Fr::from(aegis_common::fr_u64(&env, t_n)),
        ];
        if !groth16::verify(&env, &vk, &proof, signals) {
            return Err(Error::BadProof);
        }

        // 7. Effect (I8): flight verified. No token movement here.
        s.flight_ok = true;
        env.storage().persistent().set(&key, &s);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        FlightVerified { id }.publish(&env);

        Ok(())
    }

    /// Refund the remaining escrow to the merchant after the deadline.
    /// Permissionless (T11): anyone may trigger it; funds only ever flow to
    /// the stored merchant. `Open | InTransit → Expired`.
    ///
    /// Confidential rail (§6.6): the state flip is the whole effect —
    /// `amount == 0` so no transfer happens here. The merchant then settles
    /// off-registry with `confidential_transfer(E → merchant)`, admitted by
    /// the hook via `release_allowed(id, merchant)` once state is Expired.
    pub fn refund_expired(env: Env, id: u64) -> Result<(), Error> {
        let key = DataKey::Ship(id);
        let mut s: Shipment = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotFound)?;

        // Legal predecessor states (I4).
        match s.state {
            State::Open | State::InTransit => {}
            _ => return Err(Error::WrongState),
        }
        if env.ledger().timestamp() <= s.escrow_deadline {
            return Err(Error::DeadlineNotPassed);
        }

        // Effects first (I8).
        s.state = State::Expired;
        // Timeout: free the merchant's count, and the carrier's if one accepted.
        Self::dec_active(&env, &s.merchant);
        if let Some(c) = &s.carrier {
            Self::dec_active(&env, c);
        }
        let remaining = s.amount - s.paid;
        let merchant = s.merchant.clone();
        let token = s.token.clone();
        env.storage().persistent().set(&key, &s);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        if remaining > 0 {
            TokenClient::new(&env, &token).transfer(
                &env.current_contract_address(),
                &merchant,
                &remaining,
            );
        }

        ShipmentExpired { id }.publish(&env);

        Ok(())
    }

    /// Return the stored shipment record — already all-opaque/public data.
    pub fn status(env: Env, id: u64) -> Result<Shipment, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Ship(id))
            .ok_or(Error::NotFound)
    }

    /// Escrow-account → shipment-id lookup (§6.6). The CT token's hooks
    /// cross-call this to decide whether `from` is a caged escrow at all;
    /// `None` means "not an escrow — hooks don't apply".
    pub fn escrow_of(env: Env, escrow: Address) -> Option<u64> {
        env.storage().persistent().get(&DataKey::Escrow(escrow))
    }

    /// Hook decision view (§6.6): may shipment `id`'s escrowed funds move to
    /// `to`? True iff `Delivered ⇒ to == stored payout` or
    /// `Expired ⇒ to == merchant`. The refund address is the merchant —
    /// DESIGN's `refund_addr` simplified to the stored merchant.
    ///
    /// NEVER panics: an unknown id, a pre-terminal state, or a wrong `to`
    /// all return `false` — the token's hook turns that into the abort.
    pub fn release_allowed(env: Env, id: u64, to: Address) -> bool {
        match env
            .storage()
            .persistent()
            .get::<_, Shipment>(&DataKey::Ship(id))
        {
            Some(s) => match s.state {
                State::Delivered => s.payout == Some(to),
                State::Expired => s.merchant == to,
                _ => false,
            },
            None => false,
        }
    }

    /// Explicitly register/switch the caller's role. A switch (changing to a
    /// different role) is allowed only when the caller has no active services
    /// (`RoleLocked` otherwise). Setting the role you already hold is a no-op.
    /// Auto-binding on `create_shipment`/`accept` means calling this is
    /// optional, but the frontend uses it to record the role at selection time.
    pub fn set_role(env: Env, caller: Address, role: Role) -> Result<(), Error> {
        caller.require_auth();
        let rkey = DataKey::Role(caller.clone());
        let current: Option<Role> = env.storage().persistent().get(&rkey);
        if current == Some(role) {
            return Ok(());
        }
        if Self::active_of(&env, &caller) != 0 {
            return Err(Error::RoleLocked);
        }
        env.storage().persistent().set(&rkey, &role);
        env.storage()
            .persistent()
            .extend_ttl(&rkey, TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(())
    }

    /// The caller's bound role, if any.
    pub fn role_of(env: Env, addr: Address) -> Option<Role> {
        env.storage().persistent().get(&DataKey::Role(addr))
    }

    /// The wallet's active-service count (0 if unset) — the frontend gates role
    /// switching on this being 0.
    pub fn active_count(env: Env, addr: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Active(addr))
            .unwrap_or(0)
    }
}
