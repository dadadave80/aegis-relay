# Security Policy

## Status: testnet demo — not for production

Aegis Relay is a hackathon project (**Stellar Hacks: Real-World ZK**) running on
**Stellar Testnet**. **Do not use it to secure real value.** Its trust boundaries
are stated plainly in the README's *Honest Limitations* — in particular:

- The confidential-escrow rail consumes an **unaudited** OpenZeppelin UltraHonk
  preview (upstream: not production-ready).
- The Groth16 trusted setup is a **single-contributor development ceremony** (an
  MPC ceremony is roadmap).
- The drone attestation is a **labeled software simulator** — the proof trusts a
  signing key, not physics.
- The marketplace web app's off-chain conveniences (self-serve credentialing, the
  KV store, unauthenticated demo APIs) are a **demo UX layer, not a security
  boundary**. The on-chain ZK proofs and Soroban contracts are the boundary.

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

- **Preferred:** open a private **GitHub Security Advisory** — *Security → Report a
  vulnerability* on this repository.
- **Or email:** developer@randao.net

Please include steps to reproduce, the affected component, and the impact. We'll
acknowledge your report and coordinate a fix. As a testnet demo there is no
bug-bounty program.

## Scope

**In scope:** the Soroban contracts (`contracts/`), the circom circuits
(`circuits/`), and the prover / dashboard code.

**Out of scope:** the vendored `@ctd/sdk` and its OpenZeppelin upstream (report to
their projects), and the known, documented limitations listed above.
