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

/// Escrow rail (DESIGN.md §6.6). Only `Transparent` is supported in this
/// build; `Confidential` (rung R3) lands later and is rejected at `create`.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Rail {
    Transparent = 0,
    Confidential = 1,
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
    /// Only the transparent rail is supported in this build.
    RailUnsupported = 9,
    /// `method == Drone` requires a verified flight before `deliver` (I4).
    FlightRequired = 10,
    /// No shipment stored under this id.
    NotFound = 11,
    /// `amount <= 0`.
    AmountInvalid = 12,
    /// `escrow_deadline` not in the future.
    DeadlineInvalid = 13,
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

    /// Create a shipment and escrow `amount` of `token` in the contract.
    ///
    /// Steps:
    ///   0. `merchant.require_auth()` — before any state touch.
    ///   1. Validate: `amount > 0`; `escrow_deadline` in the future;
    ///      milestones len 1–2, each > 0, Σ == 10 000 exactly (I7);
    ///      `rail == Transparent` (confidential rail lands later).
    ///   2. Allocate the next sequential id (first shipment is 1) and store
    ///      the record (state before interaction — I8).
    ///   3. Pull the escrow in: `token.transfer(merchant → contract)`.
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
    ) -> Result<u64, Error> {
        // 0. Auth first.
        merchant.require_auth();

        // 1. Validation.
        if amount <= 0 {
            return Err(Error::AmountInvalid);
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
        if rail != Rail::Transparent {
            return Err(Error::RailUnsupported);
        }

        // 2. Allocate id (counter starts at 1) and store the record.
        let id: u64 = env
            .storage()
            .instance()
            .get::<_, u64>(&DataKey::Counter)
            .unwrap_or(0)
            + 1;
        env.storage().instance().set(&DataKey::Counter, &id);

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
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        // 3. Escrow in — after all validation and after the state write.
        TokenClient::new(&env, &token).transfer(
            &merchant,
            &env.current_contract_address(),
            &amount,
        );

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

    /// Refund the remaining escrow to the merchant after the deadline.
    /// Permissionless (T11): anyone may trigger it; funds only ever flow to
    /// the stored merchant. `Open | InTransit → Expired`.
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
}
