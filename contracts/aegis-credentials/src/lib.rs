#![no_std]

//! `aegis-credentials` — thin authorized root store for the carrier-credential
//! Merkle tree.
//!
//! A single writer (the `issuer` set at construction) publishes successive
//! Merkle roots of the carrier-credential tree, one per monotonically
//! increasing `epoch`. `aegis-registry` reads `current()` server-side and feeds
//! the root into a proof's public inputs (I1: roots come from contract storage,
//! never from tx args). Root/epoch are public by design, so `set_root` emits
//! them in a clear event.
//!
//! Mirrors the v1 proof-of-reserves hardening ("Limitation 0 — CLOSED"):
//! `require_auth` before any state touch, single-writer state, instance TTL
//! bumped on every write.

use soroban_sdk::{
    contract, contractevent, contracterror, contractimpl, contracttype, panic_with_error, Address,
    Env, U256,
};

/// Instance-storage TTL bump applied on every `set_root` (in ledgers). Keeps
/// the issuer address and the current root alive well past any judging/demo
/// window (~29 days at ~5s/ledger) so `current()` never bricks between updates.
/// Same constants as the v1 donor contract.
const TTL_THRESHOLD: u32 = 100_000;
const TTL_EXTEND_TO: u32 = 500_000;

// ── Types ─────────────────────────────────────────────────────────────────────

/// The current published root and the epoch it belongs to.
#[contracttype]
#[derive(Clone)]
pub struct RootRecord {
    pub root: U256,
    pub epoch: u32,
}

#[contracttype]
pub enum DataKey {
    /// The `Address` authorized to publish roots. Set once in the constructor.
    Issuer,
    /// The current `RootRecord`. Absent until the first `set_root`.
    Root,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    /// `current()` was called before any root has been published.
    NoRoot = 1,
    /// The submitted epoch is not strictly greater than the stored epoch.
    EpochNotIncreasing = 2,
}

// ── Events ────────────────────────────────────────────────────────────────────

/// Emitted when a new carrier-credential root is published. Root/epoch are
/// public by design, so both travel in the clear for indexers.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RootPublished {
    /// The epoch this root belongs to.
    #[topic]
    pub epoch: u32,
    /// The Merkle root of the carrier-credential tree for this epoch.
    pub root: U256,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct CredentialsContract;

#[contractimpl]
impl CredentialsContract {
    /// Initialise the store with the single `issuer` authorized to publish
    /// roots. Must be called once at deployment (Soroban constructor).
    pub fn __constructor(env: Env, issuer: Address) {
        env.storage().instance().set(&DataKey::Issuer, &issuer);
    }

    /// Publish a new carrier-credential Merkle `root` for `epoch`.
    ///
    /// Steps:
    ///   0. Require authorization from the configured issuer (before any state touch).
    ///   1. Require `epoch` strictly greater than the stored epoch (first call: any epoch).
    ///   2. Persist `(root, epoch)` and bump the instance TTL.
    ///   3. Emit `RootPublished`.
    pub fn set_root(env: Env, root: U256, epoch: u32) -> Result<(), Error> {
        // 0. Only the configured issuer may write.
        let issuer: Address = env.storage().instance().get(&DataKey::Issuer).unwrap();
        issuer.require_auth();

        // 1. Strictly increasing epoch (any epoch accepted on the first call).
        if let Some(prev) = env
            .storage()
            .instance()
            .get::<_, RootRecord>(&DataKey::Root)
        {
            if epoch <= prev.epoch {
                return Err(Error::EpochNotIncreasing);
            }
        }

        // 2. Persist and keep the instance alive past any demo window.
        env.storage().instance().set(
            &DataKey::Root,
            &RootRecord {
                root: root.clone(),
                epoch,
            },
        );
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        // 3. Public-by-design event.
        RootPublished { epoch, root }.publish(&env);

        Ok(())
    }

    /// Return the current `(root, epoch)`. Panics with `Error::NoRoot` if no
    /// root has been published yet.
    pub fn current(env: Env) -> (U256, u32) {
        match env
            .storage()
            .instance()
            .get::<_, RootRecord>(&DataKey::Root)
        {
            Some(r) => (r.root, r.epoch),
            None => panic_with_error!(&env, Error::NoRoot),
        }
    }
}

#[cfg(test)]
mod test;
