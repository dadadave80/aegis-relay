# Plan 001: Enforce one role per wallet on-chain (registry role binding)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat d65bd16..HEAD -- contracts/aegis-registry/src/lib.rs contracts/aegis-registry/src/test.rs`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (touches the fund-moving entrypoints; requires a redeploy)
- **Depends on**: none
- **Category**: security / feature
- **Planned at**: commit `d65bd16`, 2026-07-03

## Why this matters

The product rule is: **a wallet can hold only one role at a time, and may
switch roles only when it has no active service in its current role.** Today
the registry has no concept of a wallet's role — the same address can
`create_shipment` (a merchant action) and `accept` (a carrier action) with no
restriction. This plan makes the two fund-moving roles mutually exclusive
**on-chain**, so the guarantee holds regardless of what any UI does. It also
exposes read views (`role_of`, `active_count`) the frontend (plan 003) needs to
gate role switching, and a `set_role` entrypoint for explicit role registration.

"Active service" is defined by the state machine already in the contract: a
merchant's shipment is active while `state ∈ {Open, InTransit}`; a carrier's is
active while `state == InTransit`. Both end at the terminal states `Delivered`
(via `deliver`) and `Expired` (via `refund_expired`). We track this with a
per-wallet counter incremented at `create`/`accept` and decremented when a
shipment reaches a terminal state.

There is **no "attacker" role and none is needed**: malicious actions are
already caught by the existing guards (`BadProof`, `WrongState`,
`NullifierSpent`, `TsBeforeAccept`, `require_auth`, …). This plan adds two more
guard errors — `WrongRole` and `RoleLocked` — for role violations.

## Current state

File: `contracts/aegis-registry/src/lib.rs` (857 lines). Package `aegis-registry`.

**Error enum — highest discriminant is 22 (`EscrowInUse`), lib.rs:135-189.** The
repo convention is to never renumber (see `RailUnsupported = 9` kept at
lib.rs:154-156). Append new errors as 23, 24:

```rust
// lib.rs:186-188 (tail of the enum)
    /// The escrow account is already mapped to a shipment (one `E` per
    /// shipment, never reused).
    EscrowInUse = 22,
}
```

**Enums use `#[contracttype] #[repr(u32)]`** — e.g. `State`, lib.rs:74-82:

```rust
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum State { Open = 0, InTransit = 1, Delivered = 2, Expired = 3 }
```

**`DataKey` enum, lib.rs:117-133** — the only `Address`-keyed entry today is
`Escrow(Address)`. There is NO wallet→role or wallet→count index:

```rust
#[contracttype]
pub enum DataKey {
    Admin, VkDelivery, VkFlight, Credentials, Airspace, Counter,
    Ship(u64), Null(U256), Escrow(Address), CtToken,
}
```

**TTL bump pattern (inline, no helper), lib.rs:41-42 + every write site.**
Constants: `const TTL_THRESHOLD: u32 = 100_000;` `const TTL_EXTEND_TO: u32 = 500_000;`.
Persistent writes always follow `set` with `extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO)`
(e.g. lib.rs:427-430) plus an instance bump. Match this for any new persistent key.

**`create_shipment`, lib.rs:329-461.** After `merchant.require_auth()` (343) and
all validation, it allocates the id (399-405), builds + stores the `Shipment`
(407-441), then transfers escrow in (449-455) and emits `ShipmentCreated`. The
`merchant: Address` param is the wallet whose role is Merchant.

**`accept`, lib.rs:476-534.** After `carrier.require_auth()` (484), loads the
shipment (486-491), asserts `state == Open` (494-496), then writes custody
fields (499-504) and stores (514-517). The `carrier: Address` param is the
wallet whose role is Carrier. Write-once is structural (a second accept hits
`WrongState`).

**`deliver`, lib.rs:560-654.** Sets `s.state = State::Delivered` (626); stored
`s.carrier: Option<Address>` and `s.merchant: Address` identify the two wallets
whose service just ended. Storage write at 631-634.

**`refund_expired`, lib.rs:778-819.** Sets `s.state = State::Expired` (796);
`s.merchant` and `s.carrier` (may be `None` if never accepted) identify the
wallets whose service ended. Storage write at 800-803.

**Views** `status` (822-827), `escrow_of` (832-834), `release_allowed` (843-856)
show the view style: read persistent storage, return, never panic.

Test file: `contracts/aegis-registry/src/test.rs` (1382 lines).
- `setup(env, vk) -> (RegistryContractClient, token, merchant)`, test.rs:89-114 —
  `env.mock_all_auths()`, registers a SAC + the registry, returns a client.
- `create_default(env, client, token, merchant, c_s) -> u64`, test.rs:126-145 —
  wraps `client.create_shipment(...)` with the pinned args.
- Error-assert pattern: `let res = client.try_<fn>(...); assert_eq!(res, Err(Ok(Error::X)));`
  (e.g. test.rs:278, 532). Auth-failure pattern: `assert!(res.is_err())` (test.rs:583).
- Full-lifecycle template `happy_courier_delivery`, test.rs:156-205: create (merchant
  from `setup`) → accept (a **fresh** `Address::generate` carrier) → deliver.
  **Merchant and carrier are distinct addresses** — this is the norm across tests.

Design vocabulary (docs/DESIGN.md §3): the on-chain transacting roles are
**merchant** (`create_shipment`) and **carrier** (`accept`). Recipient never
transacts on-chain; issuer/authority live in sibling contracts. So on-chain
role binding governs merchant and carrier only.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Test (unit) | `cargo test -p aegis-registry --offline` | all tests pass |
| Build wasm | `cargo build --workspace --target wasm32v1-none --release --offline` | exit 0 |

(`--offline` is used because this sandbox has no crates.io access; a normal
clone can drop it. Toolchain pinned in `rust-toolchain.toml`: stable +
`wasm32v1-none`.)

## Scope

**In scope** (only files you modify):
- `contracts/aegis-registry/src/lib.rs`
- `contracts/aegis-registry/src/test.rs`

**Out of scope** (do NOT touch):
- `contracts/aegis-registry/src/groth16.rs`, `src/test_fixtures*.rs` — proof
  machinery, unrelated.
- Any other contract crate (`aegis-common`, `aegis-airspace`, `contracts-ct/`).
- The dashboard — plan 003 wires the UI to these new entrypoints.
- Do NOT renumber any existing `Error` variant (clients + fixtures depend on the
  numbering).
- Do NOT add `require_auth` to `deliver`/`submit_flight`/`refund_expired` — they
  are permissionless by design (I3/T3/T11).

## Git workflow

- Branch: `advisor/001-onchain-role-binding`.
- Commit style matches the repo (conventional, scoped): e.g.
  `feat(registry): bind one role per wallet on-chain (WrongRole/RoleLocked)`.
- Do NOT push or open a PR unless the operator asks.

## Steps

### Step 1: Add the `Role` enum, `DataKey` variants, and two error codes

In `contracts/aegis-registry/src/lib.rs`:

1. Add a `Role` enum next to `Method`/`Rail` (after the `Rail` enum, ~lib.rs:70):

```rust
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
```

2. Add two `DataKey` variants (inside the enum, lib.rs:117-133):

```rust
    /// Wallet → its currently bound role (persistent, TTL-bumped).
    Role(Address),
    /// Wallet → count of non-terminal services it is rendering in its bound
    /// role. Switching roles is only allowed at 0 (persistent, TTL-bumped).
    Active(Address),
```

3. Append two error variants after `EscrowInUse = 22` (lib.rs:188), keeping the
   trailing `}`:

```rust
    /// The wallet is bound to a different role and still has active services in
    /// it — it cannot act in this role until those services reach a terminal
    /// state. (One role per wallet at a time.)
    WrongRole = 23,
    /// `set_role` attempted a role switch while the wallet still has active
    /// services — switch only when idle.
    RoleLocked = 24,
```

**Verify**: `cargo build -p aegis-registry --offline` → exit 0 (compiles;
unused-warning on the new items is fine at this step).

### Step 2: Add the role helpers (private fns inside `impl RegistryContract`)

Add these near the top of the `#[contractimpl] impl RegistryContract` block
(they are not `pub`, so they are helpers, not entrypoints). Place them right
after `__constructor` or at the end of the impl — either compiles.

```rust
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
```

**Verify**: `cargo build -p aegis-registry --offline` → exit 0.

### Step 3: Enforce + count the merchant role in `create_shipment`

In `create_shipment` (lib.rs:329-461), after the id is allocated and BEFORE the
escrow transfer — the cleanest spot is right after `env.storage().instance().set(&DataKey::Counter, &id);`
(lib.rs:405) — bind and count the merchant:

```rust
        // Role binding: the creator acts as Merchant. Rejects if the wallet is
        // an active Carrier (WrongRole); auto-binds/auto-switches when idle.
        Self::bind_role(&env, &merchant, Role::Merchant)?;
        Self::inc_active(&env, &merchant);
```

Placement note: it must be after `merchant.require_auth()` (343) and after all
validation returns, so a rejected create never binds or counts. Right after the
counter write (405) satisfies this.

**Verify**: `cargo build -p aegis-registry --offline` → exit 0.

### Step 4: Enforce + count the carrier role in `accept`

In `accept` (lib.rs:476-534), after the `state == Open` check (494-496) and
before writing custody fields (499), add:

```rust
        // Role binding: the acceptor acts as Carrier. Rejects if the wallet is
        // an active Merchant (WrongRole); auto-binds/auto-switches when idle.
        Self::bind_role(&env, &carrier, Role::Carrier)?;
        Self::inc_active(&env, &carrier);
```

**Verify**: `cargo build -p aegis-registry --offline` → exit 0.

### Step 5: Release the counts at terminal states

In `deliver` (lib.rs:560-654), right after `s.state = State::Delivered;`
(lib.rs:626), decrement both parties (the carrier is always `Some` here because
state was `InTransit`):

```rust
        // Service complete: free both wallets' active counts so they may switch
        // roles. carrier is Some here (state was InTransit).
        Self::dec_active(&env, &s.merchant);
        if let Some(c) = &s.carrier {
            Self::dec_active(&env, c);
        }
```

In `refund_expired` (lib.rs:778-819), right after `s.state = State::Expired;`
(lib.rs:796):

```rust
        // Timeout: free the merchant's count, and the carrier's if one accepted.
        Self::dec_active(&env, &s.merchant);
        if let Some(c) = &s.carrier {
            Self::dec_active(&env, c);
        }
```

**Verify**: `cargo build -p aegis-registry --offline` → exit 0.

### Step 6: Add `set_role`, `role_of`, `active_count` entrypoints

Add these as `pub` fns in the `#[contractimpl]` block (entrypoints):

```rust
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
```

**Verify**: `cargo build -p aegis-registry --offline` → exit 0, no warnings.

### Step 7: Add tests

In `contracts/aegis-registry/src/test.rs`, add the import of `Role` to the
`use crate::{...}` block (test.rs:22-25 currently imports
`Error, Method, Rail, RegistryContract, RegistryContractClient, State` — add `Role`).

Add these tests (model their structure on `happy_courier_delivery` test.rs:156-205
and `accept_wrong_state` test.rs:514-544). They need no proof fixtures except the
happy-lifecycle one already used by `happy_courier_delivery`:

```rust
#[test]
fn role_exclusivity_merchant_cannot_accept() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, test_fixtures::delivery_vk(&env));
    mint(&env, &token, &merchant, AMOUNT);
    // merchant creates → bound Merchant with an active service.
    let id = create_default(&env, &client, &token, &merchant, &U256::from_u32(&env, 7));
    // The SAME wallet tries to accept (a Carrier action) → WrongRole.
    let res = client.try_accept(&id, &merchant, &merchant, &U256::from_u32(&env, 9));
    assert_eq!(res, Err(Ok(Error::WrongRole)), "active merchant cannot accept");
    assert_eq!(client.role_of(&merchant), Some(Role::Merchant));
    assert_eq!(client.active_count(&merchant), 1);
}

#[test]
fn role_switch_allowed_when_idle() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, test_fixtures::delivery_vk(&env));
    let fx = test_fixtures::valid_delivery(&env);
    mint(&env, &token, &merchant, AMOUNT);
    // Full lifecycle as merchant so the wallet ends idle (active back to 0).
    let id = create_default(&env, &client, &token, &merchant, &fx.c_s);
    let payout = Address::generate(&env);
    let carrier = Address::generate(&env);
    client.accept(&id, &carrier, &payout, &fx.carrier_pk_commit);
    env.ledger().set_timestamp(DELIVER_LEDGER_TS);
    client.deliver(&id, &fx.proof, &fx.nullifier, &fx.ts);
    assert_eq!(client.active_count(&merchant), 0, "merchant idle after delivery");
    // Now idle → the merchant wallet may switch to Carrier via set_role.
    client.set_role(&merchant, &Role::Carrier);
    assert_eq!(client.role_of(&merchant), Some(Role::Carrier));
}

#[test]
fn set_role_locked_while_active() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, test_fixtures::delivery_vk(&env));
    mint(&env, &token, &merchant, AMOUNT);
    let _ = create_default(&env, &client, &token, &merchant, &U256::from_u32(&env, 5));
    // Active merchant cannot switch to Carrier.
    let res = client.try_set_role(&merchant, &Role::Carrier);
    assert_eq!(res, Err(Ok(Error::RoleLocked)), "cannot switch while active");
}

#[test]
fn active_count_tracks_lifecycle() {
    let env = Env::default();
    env.ledger().set_timestamp(ACCEPT_LEDGER_TS);
    let (client, token, merchant) = setup(&env, test_fixtures::delivery_vk(&env));
    let fx = test_fixtures::valid_delivery(&env);
    mint(&env, &token, &merchant, AMOUNT);
    let carrier = Address::generate(&env);
    let payout = Address::generate(&env);
    let id = create_default(&env, &client, &token, &merchant, &fx.c_s);
    assert_eq!(client.active_count(&merchant), 1);
    client.accept(&id, &carrier, &payout, &fx.carrier_pk_commit);
    assert_eq!(client.active_count(&carrier), 1);
    assert_eq!(client.role_of(&carrier), Some(Role::Carrier));
    env.ledger().set_timestamp(DELIVER_LEDGER_TS);
    client.deliver(&id, &fx.proof, &fx.nullifier, &fx.ts);
    assert_eq!(client.active_count(&merchant), 0, "merchant freed");
    assert_eq!(client.active_count(&carrier), 0, "carrier freed");
}
```

**Verify**: `cargo test -p aegis-registry --offline` → the 4 new tests pass AND
every pre-existing test still passes.

### Step 8: Full build gate

**Verify**:
`cargo build --workspace --target wasm32v1-none --release --offline` → exit 0.

## Test plan

- New tests (all in `contracts/aegis-registry/src/test.rs`, patterned on
  `happy_courier_delivery` and `accept_wrong_state`):
  - `role_exclusivity_merchant_cannot_accept` — an active merchant wallet
    calling `accept` → `WrongRole`.
  - `role_switch_allowed_when_idle` — a merchant who completed a delivery
    (active back to 0) can `set_role(Carrier)`.
  - `set_role_locked_while_active` — an active merchant `set_role(Carrier)` →
    `RoleLocked`.
  - `active_count_tracks_lifecycle` — count 0→1 on create/accept, back to 0 on
    deliver, and `role_of` reflects the binding.
- Regression: the ENTIRE existing suite must still pass unchanged.
- Verification: `cargo test -p aegis-registry --offline` → all pass (existing + 4 new).

## Done criteria

ALL must hold:

- [ ] `cargo test -p aegis-registry --offline` exits 0; the 4 new tests pass and
      every pre-existing test still passes.
- [ ] `cargo build --workspace --target wasm32v1-none --release --offline` exits 0.
- [ ] `grep -n "WrongRole = 23" contracts/aegis-registry/src/lib.rs` and
      `grep -n "RoleLocked = 24" contracts/aegis-registry/src/lib.rs` each return
      one line; no existing error discriminant was changed
      (`grep -n "EscrowInUse = 22" …` still present).
- [ ] `set_role`, `role_of`, `active_count` are `pub` fns
      (`grep -n "pub fn set_role\|pub fn role_of\|pub fn active_count" …` → 3 lines).
- [ ] No files outside the in-scope list are modified (`git status`).
- [ ] `plans/README.md` status row for 001 updated.

## STOP conditions

Stop and report (do not improvise) if:

- The drift check shows `lib.rs` or `test.rs` changed since `d65bd16` and the
  "Current state" excerpts no longer match.
- A pre-existing test fails **because it reuses one `Address` as both the
  merchant and the carrier** of the same lifecycle (role binding will now reject
  that with `WrongRole`). This is expected only if such a test exists — report
  which test, and the intended fix (give it distinct `Address::generate`
  merchant/carrier), before changing any test's intent.
- The highest existing error discriminant is not 22 (someone added errors since
  this plan) — re-pick the next free numbers instead of 23/24 and note it.
- `cargo test` fails twice after a reasonable fix attempt.

## Maintenance notes

- **Redeploy is required.** These are new entrypoints + new storage; the running
  testnet registry (`CC4HXXHUE6ZCIVVN4XAHPV4JMYHEWK7ZIKILQMG5WCJ4V67NWLFTVGCA`)
  must be redeployed and the new id recorded in `docs/testnet.md` and
  `dashboard/lib/contract.ts` / `dashboard/components/console/config.ts` before
  plan 003's UI can call `set_role`/`role_of`/`active_count`. Redeploy steps live
  in `prover/scripts/deploy-all.mjs` (adapt/rerun; record the new ids). This is
  the hard dependency plan 003 waits on.
- **Recipient/auditor are intentionally not bound on-chain** — they never
  transact on the registry (DESIGN.md §3). If a future role gains an on-chain
  fund-moving entrypoint, add it to the `Role` enum and bind it at that
  entrypoint the same way.
- **Auto-bind vs. explicit `set_role`**: `create_shipment`/`accept` auto-bind on
  first action and auto-switch when idle, so the contract enforces exclusivity
  even if a client never calls `set_role`. `set_role` exists so the UI can record
  the role at selection time and so switching can be an explicit, gated action.
  A reviewer should confirm both paths agree (they share the "switch only when
  active == 0" rule).
- A reviewer should scrutinize: the `dec_active` calls are on the exact terminal
  transitions and nowhere else (no double-decrement), and `inc_active` happens
  only on the success path of create/accept (never on a rejected call).
