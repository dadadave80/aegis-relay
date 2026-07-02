#![no_std]

//! `aegis-airspace` — regulator-approved corridor roots per lane.
//!
//! A single writer (the `authority` set at construction) approves, per lane, a
//! Merkle `root` of the permitted corridor set together with the validity
//! window `[valid_from, valid_to)`. `aegis-registry` reads `corridor(lane_id)`
//! server-side and feeds the root into a proof's public inputs (I1: roots come
//! from contract storage, never from tx args).
//!
//! This store deliberately does NOT filter by time — it returns the raw record.
//! The registry (a separate contract) enforces the time window against the
//! ledger timestamp at settlement. Corridor roots/windows are public by design.
//!
//! Mirrors the v1 proof-of-reserves hardening: `require_auth` before any state
//! touch, single-writer state, TTL bumped on every write.

use soroban_sdk::{
    contract, contractevent, contracterror, contractimpl, contracttype, panic_with_error, Address,
    Env, U256,
};

/// TTL bump (in ledgers) applied to the instance and to each written corridor
/// entry. Keeps the authority address and approved corridors alive well past
/// any judging/demo window (~29 days at ~5s/ledger). Same constants as v1.
const TTL_THRESHOLD: u32 = 100_000;
const TTL_EXTEND_TO: u32 = 500_000;

// ── Types ─────────────────────────────────────────────────────────────────────

/// An approved corridor: the Merkle root of the permitted-corridor set for a
/// lane and the validity window it applies to. `valid_from`/`valid_to` are unix
/// seconds; the window is half-open `[valid_from, valid_to)` and enforced by the
/// registry, not here.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CorridorInfo {
    pub root: U256,
    pub valid_from: u64,
    pub valid_to: u64,
}

#[contracttype]
pub enum DataKey {
    /// The `Address` authorized to approve corridors. Set once in the constructor.
    Authority,
    /// A per-lane `CorridorInfo`, keyed by `lane_id`. Persistent storage.
    Corridor(u32),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    /// `corridor()` was called for a lane that has never been approved.
    UnknownLane = 1,
    /// `valid_from` is not strictly less than `valid_to`.
    InvalidWindow = 2,
}

// ── Events ────────────────────────────────────────────────────────────────────

/// Emitted when a lane's corridor is approved (or re-approved). Corridor
/// roots/windows are public by design, so all fields travel in the clear.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CorridorApproved {
    /// The lane this corridor applies to.
    #[topic]
    pub lane_id: u32,
    /// The Merkle root of the permitted-corridor set for this lane.
    pub root: U256,
    /// Window start (unix seconds, inclusive).
    pub valid_from: u64,
    /// Window end (unix seconds, exclusive).
    pub valid_to: u64,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct AirspaceContract;

#[contractimpl]
impl AirspaceContract {
    /// Initialise the store with the single `authority` authorized to approve
    /// corridors. Must be called once at deployment (Soroban constructor).
    pub fn __constructor(env: Env, authority: Address) {
        env.storage().instance().set(&DataKey::Authority, &authority);
    }

    /// Approve (or re-approve) the corridor `root` for `lane_id`, valid over
    /// `[valid_from, valid_to)`.
    ///
    /// Steps:
    ///   0. Require authorization from the configured authority (before any state touch).
    ///   1. Require `valid_from < valid_to`.
    ///   2. Persist the per-lane record (overwriting any prior one) and bump TTLs.
    ///   3. Emit `CorridorApproved`.
    pub fn approve_corridor(
        env: Env,
        lane_id: u32,
        root: U256,
        valid_from: u64,
        valid_to: u64,
    ) -> Result<(), Error> {
        // 0. Only the configured authority may write.
        let authority: Address = env.storage().instance().get(&DataKey::Authority).unwrap();
        authority.require_auth();

        // 1. Sane window.
        if valid_from >= valid_to {
            return Err(Error::InvalidWindow);
        }

        // 2. Persist per-lane (overwrites prior approval for this lane) and keep alive.
        let key = DataKey::Corridor(lane_id);
        env.storage().persistent().set(
            &key,
            &CorridorInfo {
                root: root.clone(),
                valid_from,
                valid_to,
            },
        );
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        // 3. Public-by-design event.
        CorridorApproved {
            lane_id,
            root,
            valid_from,
            valid_to,
        }
        .publish(&env);

        Ok(())
    }

    /// Return the raw `CorridorInfo` for `lane_id`. Panics with
    /// `Error::UnknownLane` if the lane has never been approved.
    ///
    /// Does NOT filter by time — the registry enforces the window.
    pub fn corridor(env: Env, lane_id: u32) -> CorridorInfo {
        match env
            .storage()
            .persistent()
            .get::<_, CorridorInfo>(&DataKey::Corridor(lane_id))
        {
            Some(info) => info,
            None => panic_with_error!(&env, Error::UnknownLane),
        }
    }
}

#[cfg(test)]
mod test;
