# Aegis Relay — agent notes

Privacy-preserving supply-chain custody & delivery settlement on Stellar. Groth16/BN254 proofs (circom + snarkjs) verified on-chain via Soroban's CAP-0074/0075 host functions; verify-and-settle is atomic in one transaction.

**Normative doc — read before changing anything:**
- `ARCHITECTURE.md` — protocol semantics + technical reference (the former
  `docs/DESIGN.md` + `docs/PIVOT.md` were consolidated here; originals in git history)

## Layout

- `contracts/` — Soroban Cargo workspace (soroban-sdk 26.1.0, `hazmat-crypto`, target `wasm32v1-none`): `poseidon-merkle` (transplanted from v1, parity-pinned), `aegis-common`, `aegis-registry`, `aegis-credentials`, `aegis-airspace`.
- `contracts-ct/` — SEPARATE workspace for the OpenZeppelin confidential-token fork (R3). Build with `stellar contract build` ONLY — plain cargo fails on `experimental_spec_shaking_v2`. Never merge with `contracts/`.
- `circuits/` — circom 2.2.3. `lib/` gadgets + `delivery.circom`, `flight.circom`. Build via `circuits/build.mjs`.
- `prover/` — TypeScript CLIs (merchant/carrier/dronesim/authority) + `src/lib/` shared encoders.
- `vendor/ctd-sdk/` — vendored `@ctd/sdk` (prebuilt dist + circuits) from `brozorec/stellar-confidential-token-demo`, MIT; see `vendor/ctd-sdk/VENDORED.md`. The JS side is a **bun workspace** (root `package.json` + `bunfig.toml linker="hoisted"`; members `vendor/ctd-sdk`, `dashboard`, `prover`); `@ctd/sdk` is referenced as `workspace:*`. `circuits/` is NOT a member.

## Hard rules (PIVOT §8 — violate none)

1. Roots/`C_S`/`head` in public inputs come from contract storage, never tx args (I1).
2. Every Poseidon call has a `DOM_*` tag; never reuse tags. `PAD = poseidon2(0,0)`; membership gadgets constrain `leaf != PAD`.
3. Strict bit decomposition before every compare/multiply; ≤62-bit factors.
4. No circuit/hook is done without its negative tests (DESIGN §12 test names are normative).
5. Never regenerate a zkey without redeploying the matching contract; ptau size from the measured `.r1cs` (`2·constraints ≤ 2^k`), never guessed.
6. State writes before token transfers (I8); events stay opaque (I10).
7. Custody head is the nested arity-2 form: `poseidon2(poseidon2(DOM_ACCEPT, shipment_id), carrier_pk_commit)` — identical in Rust, circom, and TS.
8. Never present simulated drone attestation as hardware security (DESIGN §4 sentence verbatim wherever the drone is described).
9. NEVER commit a Stellar secret seed (`S[A-Z2-7]{55}`). Secrets live in env only. Scan staged diffs before committing.

## Gotchas (verified in v1 — do not rediscover)

- **node, not bun** for snarkjs proving; `circom … -l node_modules`.
- G2 encoding: `BE32(x_c1)‖BE32(x_c0)‖BE32(y_c1)‖BE32(y_c0)` — imaginary limb FIRST, inverse of snarkjs JSON order. G1: `BE32(x)‖BE32(y)`. This limb swap is the classic multi-hour footgun; it is already solved in `prover/src/lib/bn254.ts`.
- Merkle convention: even index = left child; zero-leaf padding `poseidon2(0,0)`.
- `require_auth` before any state touch; TTL bump on every persistent write.
- stellar-cli ≥27 deploy flow with constructor JSON args; target `wasm32v1-none`.

## Commands

- Contracts: `cargo test --workspace` / `cargo build --workspace --target wasm32v1-none --release`
- Circuits: `node circuits/build.mjs` (compile + ceremony + zkey; artifacts gitignored)
- JS deps: `bun install` at the repo root (bun workspace — installs dashboard + prover + vendored `@ctd/sdk` in one hoisted tree). CLIs run with `node` (snarkjs Groth16 path — `node`, not bun) or `bun` (the confidential rail, which uses `@ctd/sdk`; both resolve it via the workspace).

Provenance: bootstrapped from the v1 donor repo `dadadave80/aegis-zk-proof-of-reserves` (read-only; never modify it).
