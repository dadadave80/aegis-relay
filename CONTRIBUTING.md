# Contributing to Aegis Relay

Thanks for your interest! Aegis Relay is a privacy-preserving supply-chain custody
& delivery settlement protocol on Stellar — Groth16/BN254 zero-knowledge proofs
verified on-chain via Soroban's CAP-0074/0075 host functions. It was built for
**Stellar Hacks: Real-World ZK** (DoraHacks). Read the [README](README.md) and
[ARCHITECTURE.md](ARCHITECTURE.md) before diving in.

## Getting set up

**Prerequisites:** Rust with the `wasm32v1-none` target and `stellar-cli` ≥ 27;
**Node.js** (not bun) with **circom 2.2.3** on `PATH` for the circuits + prover;
**bun** for the dashboard.

```bash
git clone https://github.com/dadadave80/aegis-relay
cd aegis-relay
bun install                                          # JS bun workspace (dashboard + prover + vendored @ctd/sdk)
cargo test --workspace                               # Soroban contracts (52 tests)
cd contracts-ct && stellar contract build && cd ..   # confidential-token workspace (build with stellar-cli ONLY)
node circuits/test/delivery.test.mjs                 # circuits (needs circom 2.2.3 on PATH)
cd prover && npm test && cd ..                       # prover encoders / packet / CLI logic
cd dashboard && bun run build && cd ..               # the marketplace web app
```

CI runs the contracts, prover, and dashboard jobs on every push.

## Ground rules

- **Never commit a Stellar secret seed** (`S[A-Z2-7]{55}`). Secrets live in env
  only — scan your staged diff before every commit.
- `ARCHITECTURE.md` is normative for protocol semantics — read it before changing
  behavior. Every circuit or contract-hook change ships with its **negative
  tests**.
- The two Cargo workspaces (`contracts/` and `contracts-ct/`) and the two proving
  stacks (Aegis's Groth16/BN254 and the confidential rail's UltraHonk/Grumpkin)
  are kept **separate** — do not merge them.
- Use **node** (not bun) for snarkjs proving.
- Match the surrounding code style; keep changes focused.

## Pull requests

1. Branch off `main`.
2. Keep the diff small and self-contained; add tests for new behavior.
3. Make sure CI is green (contracts, prover, dashboard).
4. In the PR, say what changed and how you tested it.

## Reporting

- **Bugs / features:** open a GitHub Issue.
- **Security vulnerabilities:** do **not** open a public issue — see
  [SECURITY.md](SECURITY.md).

By contributing you agree that your contributions are licensed under the
project's [MIT License](LICENSE), and that you'll follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
