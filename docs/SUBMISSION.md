# DoraHacks BUIDL — paste-in submission text

Deadline: **2026-07-03 17:00:00 UTC**. BUIDLs are editable until then — file the
stub early, refine later.

---

## Name
Aegis Relay

## Tagline
Prove the delivery. Hide the map. Privacy-preserving supply-chain custody & delivery settlement on Stellar — with ZK-verified drone corridor compliance.

## Category / track
Real-World ZK

## The one-liner
Aegis v1 proved solvency without revealing balances. Aegis Relay proves *movement* without revealing the map — settling deliveries on Stellar while the chain never learns the contents, value, recipient, address, or route.

## Description

Global freight runs on data nobody wants to share: every intermediary — and often a public ledger — sees what's shipped, what it's worth, who's receiving it, where they live, and the exact route. Each disclosure is an attack surface: cargo theft targets manifests, competitors mine shipping graphs, and per-parcel drone corridors are an interception map.

Aegis Relay settles the full delivery lifecycle on Stellar Soroban while keeping all of it private. On-chain there is only an opaque commitment, an escrow, a state machine, and Groth16 proofs. Three ZK statements — each impossible without ZK — gate settlement:

1. **Custody** — the current holder is who the signed handoff chain says, and is a credentialed carrier, without publishing any identity.
2. **Compliance** — a drone flight stayed inside a regulator-approved corridor and respected altitude/speed/gap limits, *without publishing the route*.
3. **Delivery** — the committed recipient confirmed receipt at the committed destination region, *without revealing who or where they are*.

Each proof is verified by a Groth16 verifier assembled from Stellar's native BN254 pairing/group-op host functions plus the Poseidon permutation (CAP-0074/0075) — so verify-and-settle is a single atomic Soroban transaction. No oracle, no off-chain settlement layer.

**Headline feature — confidential escrow.** An optional rail adopts OpenZeppelin's confidential token (UltraHonk/Grumpkin) so the escrow *amount* is hidden on-chain too. Per-shipment escrow accounts are "caged" by contract hooks: possessing the key grants proof-generation capability but zero spending authority — the token asks the registry's state machine before any movement. Settlements land with no amount on the explorer; a designated regulator key can still decrypt them. Private to the world, transparent to the regulator.

## What's live on Stellar Testnet (verifiable now)

- **Confidential courier lifecycle** — 50 XLM escrowed with the amount hidden; premature-settle and withdraw-to-public both rejected on-chain by the hooks; Groth16 delivery verified; hook-admitted settlement carries no visible amount; the regulator key decrypts exactly 50 XLM.
- **Drone lifecycle** — 16-waypoint flight compressed to one Groth16 proof, verified on-chain against a regulator-published corridor root; delivered; escrow released.
- **Three distinct on-chain attack rejections** — replayed proof, tampered proof, and valid-points/wrong-proof each fail at the contract. Eight further attack modes can't even produce a proof.

Registry: `CC4HXXHUE6ZCIVVN4XAHPV4JMYHEWK7ZIKILQMG5WCJ4V67NWLFTVGCA`
(all contract IDs + tx hashes in the repo README / docs/testnet.md)

## Tech
Circom 2.2.3 + snarkjs · Groth16 / BN254 · circomlib Poseidon + EdDSA-Poseidon (Baby Jubjub) · Soroban (soroban-sdk 26.1.0, wasm32v1-none, Protocol 27) · verifier built from CAP-0074/0075 host primitives · OpenZeppelin confidential token (UltraHonk/Grumpkin) for the confidential rail · Next.js dashboard.

## Links
- GitHub (open source): https://github.com/dadadave80/aegis-relay
- Provenance (v1 donor): https://github.com/dadadave80/aegis-zk-proof-of-reserves
- Testnet registry: https://stellar.expert/explorer/testnet/contract/CC4HXXHUE6ZCIVVN4XAHPV4JMYHEWK7ZIKILQMG5WCJ4V67NWLFTVGCA
- Demo video: <PASTE AFTER RECORDING — script in docs/demo-script.md>

## Honest limitations (we lead with these)
Drone attestation is a labeled software simulator — the proof trusts the signing key, not physics (OSNMA/secure elements are roadmap). Dev trusted setup, single contributor per circuit (MPC roadmap). The confidential rail consumes OpenZeppelin's UltraHonk preview, which is explicitly unaudited / not production-ready. The auditor key sees all confidential amounts by design. Full list in the README.

---

## Remaining founder actions

1. **Record the demo video** (~2:40) — script + command crib at `docs/demo-script.md`. Point the CLIs at the deployed registry (all IDs in `docs/testnet.md`).
2. **Deploy the dashboard** (optional, nice-to-have) — from `dashboard/`: `vercel --prod` (or connect the GitHub repo in the Vercel dashboard for auto-deploy). It builds green locally today (`bun run build`); a hosted URL just needs a network/auth window the sandbox didn't have. Add the URL to the README + BUIDL when live.
3. **File the BUIDL** with the text above; paste the video link; re-open as a judge and click every link.
