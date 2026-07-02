# contracts-ct — hook-caged OpenZeppelin confidential token (Aegis fork)

Fork of `brozorec/stellar-confidential-token-demo` `contracts/` (@ `8b34def`), consuming OpenZeppelin `stellar-contracts` branch `feat/confidential-verifier-ultrahonk` (validated @ `539968f`).

**Changes vs upstream** (`token/` only; `verifier/` + `auditor/` verbatim): `type Hooks = NoHooks` →
`AegisEscrowHooks`, and the constructor pins `registry: Address` (`registry()` view — T25). For
registry-mapped escrows: `withdraw` always aborts (T24), `confidential_transfer` only to
`release_allowed` destinations (T23), both delegation paths abort; `on_register` pins `auditor_id == 0`
for everyone. Errors 4301–4305. Escrow keys grant proof-generation capability but ZERO spending authority.

**Build:** `stellar contract build` ONLY (stellar-cli ≥ 25.2.0) — plain `cargo build` fails on the
transitively-enabled `experimental_spec_shaking_v2` feature; native `cargo test` works. SEPARATE
Cargo workspace (soroban-sdk 26.0.x), never merged into root `contracts/`. **⚠️ Not production ready:**
consumes OpenZeppelin's confidential token preview — explicitly "not production ready / unaudited"
(UltraHonk backend + circuits). Demo use only.
