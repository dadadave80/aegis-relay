# Aegis Relay — Design Specification

**Privacy-preserving supply-chain custody & delivery settlement on Stellar, with drone delivery as a ZK-verified transport mode.**

| | |
|---|---|
| Spec version | 2.0.0-relay (supersedes Aegis v1 "zk-Proof-of-Reserves") |
| Written | 2026-07-02 |
| Target repo | **New repo `aegis-relay`** — a separate project bootstrapped by transplanting proven primitives from the untouched v1 donor repo `dadadave80/aegis-zk-proof-of-reserves` (PIVOT §2 / Step 0). No prior hackathon submission exists; a fresh BUIDL is filed. |
| Hackathon | Stellar Hacks: Real-World ZK (DoraHacks) — deadline **extended to 2026-07-03 17:00:00 UTC** (verified from page source epoch 1783098000) |
| Chain | Stellar Testnet, Protocol 27, Soroban (`soroban-sdk` 26.x, `wasm32v1-none`) |
| Proving stack | Circom 2.2.3 + snarkjs, Groth16, **BN254**, circomlib Poseidon + EdDSA-Poseidon (Baby Jubjub) |
| Escrow rails | Transparent XLM SAC (floor) + **confidential escrow** via the OpenZeppelin Confidential Token (UltraHonk/Grumpkin, consumed as a black box — §6.6) |
| Host functions | BN254 group ops + `pairing_check` and the Poseidon permutation (CAP-74/75 primitives). v1's Groth16 verifier is *built from* these in `groth16_verifier.rs` (84 lines, live on testnet) — there is no single "verify" host fn; transplant that file. |
| Companion doc | `PIVOT.md` — the execution playbook + verified reuse audit for Claude Code. This document is the *what/why*; that one is the *how/when*. |

---

## 1. Pitch

Global freight runs on data nobody wants to share. A merchant shipping high-value goods must reveal, to every intermediary and often to the public ledger of whatever tracking system is used: what is being shipped, how much it is worth, who is receiving it, where they live, and which route it travels. Each disclosure is an attack surface — cargo theft targets manifests, competitors mine shipping graphs, and drone corridors published per-parcel are an interception map.

**Aegis Relay** lets merchants, carriers, and recipients settle deliveries on Stellar while keeping all of that private. On-chain there is only: an opaque shipment commitment, an escrow, a state machine, and Groth16 proofs. The proofs establish, without revealing the underlying data:

1. **Custody** — the party currently holding the parcel is the one the chain of signed handoffs says it is, and is a credentialed carrier.
2. **Compliance** — for drone legs: the flight stayed inside a regulator-approved corridor, respected altitude/speed/payload limits, and had no gaps — *without publishing the route*.
3. **Delivery** — the committed recipient cryptographically confirmed receipt at the committed destination region — *without revealing who or where they are*.

Each verified proof atomically advances the shipment state machine and releases escrow milestones **in the same Soroban transaction**, using a Groth16 verifier assembled from Stellar's native BN254 pairing/group-op host functions plus the native Poseidon permutation (the CAP-74/75 primitives). That verify-and-settle atomicity — no oracle, no off-chain settlement layer — is the platform-native argument, directly continuing the thesis of Aegis v1.

**Why ZK is load-bearing (the judging test):** without ZK, every one of the three statements above requires revealing the secret it protects. Custody requires publishing carrier identities; corridor compliance requires publishing the flight path; delivery confirmation requires publishing the recipient and address. A hash-only or signature-only design either leaks the data or proves nothing. ZK is the mechanism, not a garnish.

## 2. Goals and non-goals

**Goals**

- G1. End-to-end demoable lifecycle on Stellar Testnet: create → fund escrow → carrier accept → (drone flight proof) → proof-of-delivery → atomic escrow release.
- G2. Zero on-chain disclosure of: contents, quantity, weight, value, recipient identity, destination address, carrier route, sensor data.
- G3. Drone as a first-class, *more-verified* transport mode: route-compliance proof gates settlement.
- G4. Every trust assumption stated explicitly (§4) and every identified attack mapped to a countermeasure and a test (§12). "Honest Limitations" culture from v1 is retained and expanded.
- G5. Maximal reuse of v1's proven plumbing (Poseidon parity, Groth16 verify path, ceremony tooling, CI, deploy scripts).

**Non-goals (explicitly out of scope for the hackathon build; several are designed here for the roadmap)**

- NG1. Hiding settlement *addresses* and transfer *timing* on-chain. Escrow **amounts** — formerly the headline non-goal — are now hidden in-scope via the adopted OpenZeppelin Confidential Token rail (§6.6; ladder rung R3 in PIVOT §1); §13 documents the residual leaks precisely.
- NG2. Real drone hardware. The demo uses a clearly-labeled software simulator of a drone secure element (§11.3). The cryptography is identical; the *trust anchor* (who holds the signing key) is what changes in production.
- NG3. Multi-hop custody chains of arbitrary length (circuit A4 is fully specified; implementation is a stretch layer — MVP is single-carrier custody).
- NG4. Proving physical truth. ZK verifies statements about *signed data*; §4 and §12 rows T5–T7 treat sensor spoofing as a first-class limitation with layered mitigations, not a solved problem.
- NG5. Regulatory completeness. The "airspace authority" is a mock regulator key in the demo.

## 3. Actors

| Actor | Holds | On-chain footprint | Learns |
|---|---|---|---|
| **Merchant** | Shipment plaintext, `shipment_secret`, escrow funds | Funding address, `create` tx | Everything about own shipment |
| **Carrier** (courier co. or drone operator) | Baby Jubjub carrier keypair, credential leaf, parcel | `accept` tx from a (fresh) Stellar address; payout address | Shipment packet shared off-chain by merchant (§8.2) |
| **Recipient** | Baby Jubjub recipient keypair (in wallet/PWA) | **None** — never transacts on-chain | Own shipment packet |
| **Drone secure element** (simulated in demo) | Attested EdDSA key, signs telemetry digest | None directly | Its own flight |
| **Credential issuer** (mock licensing body) | Issuer Stellar key; carrier credential tree | Publishes credential Merkle roots per epoch | Which carriers are licensed (not which shipments they carry) |
| **Airspace authority** (mock regulator) | Authority Stellar key; corridor cell trees | Publishes corridor roots per lane | Lane geometry (public by design) |
| **Arbiter** (optional, per-shipment) | Stellar key named at `create` | Dispute resolution calls | Only what disputing parties disclose to it off-chain (view-key pattern, roadmap) |
| **Public observer** | — | — | See leak table §13 |

## 4. Trust model

Be exact about what enforces what. Three enforcement classes:

**Cryptographically enforced (no trust):** commitment openings, Merkle memberships, EdDSA signature validity, custody-head transitions, nullifier uniqueness, escrow release conditions, milestone arithmetic. If the Groth16 verifier accepts and the contract's storage assertions pass, these hold under standard assumptions (discrete log on BN254/Baby Jubjub, Poseidon security) — *modulo the trusted setup, see below*.

**Trust-anchored (explicit key trust):**

- *Drone telemetry* is true only insofar as the drone attestation key signs honest data. GPS spoofing, sensor tampering, or key extraction defeat it. Production mitigations are layered, none in the hackathon build: authenticated GNSS (e.g., Galileo OSNMA), secure-element key storage, cross-witness beacons, operator stake-and-slash. **The proof means: "a key credentialed as drone class X signed a telemetry log with these properties." Nothing more. State this verbatim in the README.**
- *Credential roots* are honest only if the issuer is. Issuer key compromise mints fake carriers.
- *Corridor roots* are honest only if the authority is.
- *Groth16 trusted setup*: dev ceremony, single contributor, per circuit — same posture and same published-artifact verification instructions as v1 Limitation 1. Toxic-waste holder can forge any proof. MPC ceremony is roadmap.

**Economically enforced:** carrier shows up because milestones pay; merchant funds because escrow refunds on timeout; recipient signs because they want the goods (and a non-signing recipient only delays their own delivery — §12 T13 covers the griefing edge).

## 5. Cryptographic parameters and encodings

Everything in this section is **normative**. The same constants must exist in exactly three places, kept in lockstep by parity tests: `contracts/aegis-common` (Rust), `circuits/lib/constants.circom`, and `prover/src/lib/constants.ts`.

### 5.1 Primitives

| Primitive | Choice | Rationale |
|---|---|---|
| Proof system | Groth16 over BN254 | verifier built on native BN254 host fns (v1's `groth16_verifier.rs`, transplanted); v1 plumbing proven end-to-end; smallest proofs/cheapest verify. BN254 ≈ 100–110-bit security — carried forward as Honest Limitation, migration to BLS12-381 host fns is roadmap. |
| Hash (in-circuit, on-chain, off-chain) | Poseidon, circomlib parameters | CAP-0075 host-fn parity already test-proven in v1 (`poseidon-parity` tests). One hash everywhere; on-chain code can recompute any commitment. |
| Signatures (in-circuit) | EdDSA-Poseidon over Baby Jubjub (circomlib `EdDSAPoseidonVerifier`) | Cheap to verify inside BN254 circuits; keys generatable in browser via circomlibjs. |
| Signatures (on-chain auth) | Native Soroban `require_auth` / ed25519 | For issuer/authority/merchant/carrier *transaction* authorization only; never inside circuits. |
| Commitment randomness | 251-bit uniform field elements from CSPRNG | Full-width salts; never reuse across shipments. |

### 5.2 Domain-separation tags

Every Poseidon call takes a distinct leading tag. **A hash without a tag is a spec violation.** Tags are small Fr constants:

```
DOM_SHIP      = 1   // shipment commitment C_S
DOM_ACCEPT    = 2   // custody head, genesis (single-carrier)
DOM_HANDOFF   = 3   // custody head, advance (A4, stretch)
DOM_HANDMSG   = 4   // handoff message signed by both parties
DOM_PODMSG    = 5   // proof-of-delivery message signed by recipient
DOM_NULL      = 6   // delivery nullifier
DOM_PKC       = 7   // carrier public-key commitment
DOM_CRED      = 8   // credential tree leaf
DOM_CELL      = 9   // geocell tree leaf (corridor + dest region)
DOM_FLIGHT    = 10  // flight-log running digest init
DOM_COND      = 11  // condition-log running digest init (stretch)
DOM_EMPTY     = 12  // canonical padding leaf for fixed-depth trees (reserved, unused)
```

Padding: all Merkle trees are fixed-depth; unused leaves are the transplanted crate's canonical zero-leaf `PAD = Poseidon(0, 0)` (`DOM_EMPTY` stays reserved but unused — the v1 `poseidon-merkle` crate fixed this constant first, and one convention across three languages beats two; PIVOT §2.3). **Every membership circuit must constrain `leaf != PAD`** — otherwise padding is provable membership (threat T13).

### 5.3 Integer encodings (all range-checked in-circuit via strict bit decomposition)

| Quantity | Encoding | Bits |
|---|---|---|
| `qty` | unsigned count | 32 |
| `weight_g` | grams | 32 |
| `value_units` | token smallest unit (e.g., stroops) | 64 |
| `timestamp` | Unix seconds | 32 (valid to 2106) |
| `lat_q` | `floor((lat_deg + 90) / 180 × 2^24)` | 24 |
| `lon_q` | `floor((lon_deg + 180) / 360 × 2^24)` | 24 |
| `alt_dm` | altitude, decimeters AGL | 16 |
| milestone shares | basis points, `Σ = 10_000` enforced on-chain | 16 each |

Comparisons use circomlib `LessThan(n)` with `n` matching the declared width; **never compare un-decomposed field elements** (field wraparound is threat T14).

### 5.4 Geocells (quadtree / Morton)

A resolution-`r` cell interleaves the top `r` bits of `lat_q` with the top `r` bits of `lon_q` (Morton order) into a `2r`-bit cell id. Approximate edge sizes at the equator (lat × lon):

| r | cell ≈ | Used for |
|---|---|---|
| 15 | 611 m × 1.22 km | **RC — corridor cells** |
| 17 | 153 m × 305 m | **RD — destination region cells** |

- **Corridor tree**: fixed depth **12** (≤ 4096 RC-cells ⇒ covers ~50 km of buffered route comfortably), leaves `Poseidon(DOM_CELL, cell_id)`, PAD elsewhere. Authored off-chain from GeoJSON by the airspace authority tool (§11.2), root published on-chain per `lane_id`.
- **Destination region tree**: fixed depth **6** (≤ 64 RD-cells ⇒ up to a ~1.2 km² neighborhood). The *merchant* chooses region size: bigger region = more recipient privacy, coarser delivery assertion. Root lives *inside* `C_S` — never on-chain in the clear.
- In-circuit derivation: decompose `lat_q`, `lon_q` (24 bits each, strict), interleave top `r` bits, recompose. No trig, no floats, no polygon math in-circuit — cell membership against a pre-authored tree is the entire geometry story. This is a deliberate soundness choice: precomputed cell sets are trivially auditable; in-circuit geometry is a bug farm.

### 5.5 Speed bound (the one place fixed-point geometry appears — reasoning included because it is a classic miscalculation trap)

Meters per quantization unit: one `lat_q` unit ≈ `180°/2^24 × 111_320 m/°` ≈ **1.194 m** everywhere; one `lon_q` unit ≈ `360°/2^24 × 111_320 × cos(φ)` ≈ **2.389 × cos(φ) m ≤ 2.389 m**.

The circuit enforces, for consecutive waypoints, in *unit space*:

```
Δlat² + (2·Δlon)² ≤ (VMAX_U · Δt)²        where VMAX_U = floor(v_max_mps / 1.194)
```

Weighting `Δlon` by 2 values a lon unit at exactly `2 × 1.194 = 2.388 m` — its **maximum** real value (equator). Therefore computed distance **≥** true distance at every latitude: the check can false-reject an honest flight flying near `v_max` at high latitude (compensate by setting `v_max` with ~25% margin over the drone's real cruise), but can **never** under-measure a teleport. Conservative in the sound direction, by construction. All squared terms are range-checked to ≤ 62 bits before multiplication so products cannot wrap the 254-bit field.

### 5.6 Ceremony sizing rule (carried from v1)

Powers-of-tau size `k` must satisfy `2 × n_constraints ≤ 2^k`, measured from the compiled `.r1cs`, never guessed. Per-circuit phase-2 zkeys; artifacts published with the same `snarkjs zkey verify` reproduction instructions as v1. A regenerated VK verifies only on a contract redeployed with it (v1's exact coupling — keep the README warning).

## 6. Data model

### 6.1 Shipment commitment `C_S` (single Poseidon, 12 inputs — within circomlib's arity)

```
C_S = Poseidon(DOM_SHIP,
      sku_hash,            // Poseidon-hash of contents descriptor (off-chain doc)
      qty, weight_g, value_units,
      origin_cell,         // RC-resolution cell of pickup point
      dest_region_root,    // depth-6 Merkle root of RD cells
      recipient_pk_x, recipient_pk_y,   // Baby Jubjub point
      method,              // 1=COURIER 2=LOCKER 3=DRONE
      deadline_ts,         // private fine-grained deadline
      shipment_secret)     // 251-bit salt; also the nullifier preimage
```

On-chain, `C_S` is stored as the Fr element under a sequential `shipment_id: u64`. A **coarse public deadline** (`escrow_deadline`, rounded up to day granularity) is stored separately for the timeout path — deliberately duplicated and coarsened so the refund mechanism works without leaking the precise private deadline.

### 6.2 Custody head

Single-carrier MVP: at `accept`, the carrier supplies `carrier_pk_commit = Poseidon(DOM_PKC, pk_x, pk_y, pk_blind)` and the **contract computes** (CAP-0075):

```
head = Poseidon2(Poseidon2(DOM_ACCEPT, shipment_id), carrier_pk_commit)   // nested arity-2
```

Nested arity-2 because the transplanted crate ships only the t=3 Poseidon constants (PIVOT §2.3); the circuits mirror the nesting exactly. The carrier's circuit identity never appears on-chain even in the no-ZK-accept fallback; later circuits open `carrier_pk_commit` as witness to bind the prover to the custodian. Multi-hop (stretch, circuit A4) advances `head' = Poseidon(DOM_HANDOFF, head, next_pk_commit, ts, cell, salt)` under compare-and-swap semantics (§10, invariant I2), which makes custody forks impossible by construction.

### 6.3 Credential leaf (issuer tree, fixed depth 10, per-epoch root)

```
leaf = Poseidon(DOM_CRED, pk_x, pk_y, class, payload_limit_g, expiry_ts)
```

`class`: 1=ground courier, 2=locker operator, 3=drone. Revocation = omit the leaf from the next epoch's root; the contract only ever accepts proofs against the **current** stored root (invariant I1), so revocation latency = epoch length.

### 6.4 Nullifier

```
nullifier = Poseidon(DOM_NULL, shipment_secret)
```

One per shipment, spendable once, stored in a persistent map. Gates the terminal state transition only — funds always flow to the payout address fixed at `accept`, so nullifier front-running is inert (§12 T3).

### 6.5 Off-chain shipment packet

Everything the counterparties need, never on-chain: the full `C_S` opening, contents doc, exact address, corridor `lane_id` rationale, recipient claim link. Encrypted merchant → carrier and merchant → recipient (demo: X25519 sealed box via libsodium; format documented in `docs/packet.md`). The carrier **verifies the opening against on-chain `C_S` before accepting** — this closes the malicious-merchant-commits-garbage loophole (T12) without any circuit.

### 6.6 Confidential escrow rail (adopted: OpenZeppelin Confidential Token) — rung R3

Aegis adopts the OpenZeppelin confidential token (`stellar-contracts` branch `feat/confidential-verifier-ultrahonk`, demoed at `brozorec/stellar-confidential-token-demo`) as an **optional second escrow rail** that hides the escrow **amount** on-chain. Balances there are Pedersen commitments on Grumpkin with UltraHonk proofs verified on-chain — a *different proving stack* from Aegis's, consumed strictly as a black-box contract + `@ctd/sdk` client; the two stacks are never merged (PIVOT §0/§3). Each shipment declares `rail: Transparent | Confidential` at `create`.

**Mechanism — the hook-caged escrow account.** The OZ token exposes a `Hooks` trait invoked after auth/decode and *before* proof verification, covering every movement path (`on_register/on_deposit/on_merge/on_withdraw/on_transfer/on_spender_transfer`); a panicking hook aborts the op. Aegis deploys its own token instance with `AegisEscrowHooks`, so **key possession stops being spending authority**: per shipment, the merchant creates a fresh escrow account `E` (Stellar keypair + Grumpkin keys), registers it, and funds it with a `confidential_transfer` (amount hidden). The registry records `escrow_of(E) = shipment_id` (no funds enter the registry on this rail); `E`'s keys and the funding opening `(v, r)` travel in the shipment packet, so the **carrier decrypts and verifies the escrow balance against the on-chain commitment before accepting** — T12's packet-verify extended to funds. The hooks then enforce, for any `from` with `escrow_of(from) = Some(id)`: `on_withdraw` always panics (no exit to the public rail); `on_transfer` allows only `DELIVERED ⇒ to == stored payout` or `EXPIRED ⇒ to == stored refund_addr`; `on_spender_transfer` panics; `on_register` pins `auditor_id == 0` (the mock-regulator key). Registry and token pin each other's addresses at init/construction.

**Settlement semantics — stated honestly.** Transparent rail: verify-and-settle in one tx (unchanged). Confidential rail: **verify-then-settle in two txs** — `deliver` (Groth16 A1, state → DELIVERED, nullifier spent) then `confidential_transfer(E → payout)` signed with `E`'s packet key and admitted by the hook. Each tx is atomic, ordering is hook-enforced, and no theft window exists between them because `E` is caged. Refund mirrors it after `refund_expired()` flips EXPIRED. v0 constraint: the registry never learns the amount, so the confidential rail supports **single-milestone `[10000]` only**.

**Compliance channels, adopted as-is:** every confidential transfer emits dual auditor ciphertexts decryptable by the registered regulator key (extends v1's compliance thesis), and the SDK's off-chain **selective disclosure** lets the merchant prove one exact amount of one transfer to a designated arbiter in a dispute.

**Confidential-rail threat rows (test-mandatory, like §12):**

| # | Attack / hazard | Countermeasure | Test |
|---|---|---|---|
| T23 | Packet-key holder settles early or to the wrong address | Hook state-gate on `(state, to)` | `hook_premature_release`, `hook_wrong_dest` |
| T24 | Escrow exits to the public rail via `withdraw` | `on_withdraw` unconditional panic for escrows | `hook_withdraw_blocked` |
| T25 | Escrow run on an unhooked token instance | Registry↔token addresses mutually pinned; carrier CLI checks the token id in packet-verify | `pinned_token_addr` |
| T26 | Opening loss ⇒ funds unrecoverable (`(v,r)` live only in events; RPC retains ~7 days) | Openings persisted in the packet and CLI `out/`; sync inside the retention window | `opening_persistence` (doc-test) |
| T27 | Auditor master key ⇒ full amount visibility | Deliberate regulator design — Honest Limitation, not a bug | n/a (documented) |
| T28 | Verifier VK mutable via `manager` role ⇒ forged-proof risk | Manager = deployer key for the demo; immutable/multisig VKs roadmap — Honest Limitation | n/a (documented) |
| T29 | Unaudited UltraHonk backend + Noir circuits | Upstream's "not production ready" warning reproduced verbatim in Honest Limitations | n/a (documented) |

**Residual leaks on this rail** (also in §13): the merchant's `deposit`s into the token are **public amounts** (aggregate float, not per-shipment); settlement *addresses* and *timing* remain visible; the regulator-auditor sees all amounts by design.

## 7. Lifecycle state machine

```
                       create(C_S, escrow, method, lane_id?, milestones, escrow_deadline)
                                          │  merchant funds escrow (token.transfer → contract)
                                          ▼
                                      ┌────────┐
                     refund_expired ◀─┤ OPEN   │
                    (after deadline)  └───┬────┘
                                          │ accept(payout_addr, carrier_pk_commit [, proof A3])
                                          ▼
                                      ┌────────┐        advance(proof A4)   [stretch: multi-hop]
                     refund_expired ◀─┤IN_TRAN ├──────────────⟲  head CAS
                                      └───┬────┘
                            method=DRONE  │ submit_flight(proof A2)  → flight_ok = true
                                          ▼
                                      ┌────────┐
                                      │READY?  │   (DRONE requires flight_ok; COURIER/LOCKER skip)
                                      └───┬────┘
                                          │ deliver(proof A1, nullifier, ts)
                                          ▼
                                      ┌────────┐
                                      │DELIVERD│  → escrow released to stored payout, event emitted
                                      └────────┘
        Any pre-DELIVERED state, after escrow_deadline:
          refund_expired() → remaining escrow to merchant   (arbiter split path = roadmap)
```

State transitions are the **only** mutators; every transition asserts the expected current state (invariant I4). All rendezvous data (challenge display, claim links) is off-chain.

## 8. Protocol flows

### 8.1 Create (merchant)

1. Merchant CLI builds the shipment packet, samples `shipment_secret` and salts, computes `C_S`, picks `dest_region` cells around the address (RD-res, ≤ 64 cells — merchant-tunable privacy dial), picks `lane_id` if drone.
2. `create_shipment(...)` transfers escrow in and stores `{C_S, state=OPEN, token, amount, milestones, escrow_deadline, method, lane_id, arbiter?}`.
3. Packet sent encrypted to carrier candidates and recipient.

### 8.2 Accept (carrier)

1. Carrier decrypts packet, **verifies the `C_S` opening locally**, inspects lane/corridor (public), weight vs. fleet capability, price.
2. `accept(shipment_id, payout: Address, carrier_pk_commit [, A3 proof])`. Contract: state `OPEN→IN_TRANSIT`, stores payout **immutably**, computes `head` via Poseidon host fn. With A3 (stretch): proof binds `carrier_pk_commit` to a live credential leaf; publics checked against the *stored* issuer root.
3. Optional pickup milestone releases here (default milestone vector `[10000]` = everything at delivery; keep the vector machinery, ship the simple default).

### 8.3 Drone flight (method=DRONE)

1. Merchant (or carrier hub) loads parcel; drone secure element (simulated — §11.3) begins a telemetry log: `d_0 = Poseidon(DOM_FLIGHT, shipment_id)`, then `d_i = Poseidon(d_{i-1}, lat_q, lon_q, alt_dm, t_i)` per sample; at landing signs `d_N` once with its EdDSA key.
2. Prover CLI generates circuit **A2** proof; `submit_flight(id, proof, publics)`. Contract asserts `corridor_root == airspace.current(lane_id)` **from its own storage**, verifies via CAP-0074, checks `t_N` within freshness window and `t_0 ≥ accept_ts`, sets `flight_ok`.
3. Nothing about the route is revealed — only "the current custodian's drone flew a corridor-compliant, gap-free, speed-plausible flight for this shipment."

### 8.4 Proof of delivery (all methods)

1. At the door / locker / drone hover point, carrier device shows `shipment_id ‖ holder context`; recipient's PWA (holding the Baby Jubjub key from the claim link) signs:
   `m = Poseidon(DOM_PODMSG, shipment_id, carrier_pk_commit, cell_RD(location), ts)`
   Binding `carrier_pk_commit` means a pre-signed or stolen confirmation is useless to any *other* carrier (T8); binding `cell` ties the signature to the place; `ts` gives the contract a freshness window.
2. Carrier's prover generates **A1**; `deliver(id, proof, nullifier, ts)`. Contract: state check (+ `flight_ok` if DRONE), `|ledger_time − ts| ≤ WINDOW` (600 s) and `ts > accept_ts`, nullifier fresh → mark spent, verify proof against stored `C_S` and `head` as public inputs, release remaining escrow to the **stored** payout, `→ DELIVERED`.
3. Recipient unavailable: nothing happens; before `escrow_deadline` the carrier retries or returns; after it, `refund_expired()`. The carrier's protection against a griefing recipient is the pickup milestone + arbiter path (documented limitation, T13; attempted-delivery proofs are specced under A5-adjacent roadmap).

## 9. Circuits

Shared library components (`circuits/lib/`): `geocell.circom` (decompose + Morton + cell recompose), `merkle_fixed.circom` (fixed-depth Poseidon Merkle with `leaf != PAD` check), `log_digest.circom` (running Poseidon digest), `safe_cmp.circom` (width-checked comparisons), `constants.circom`.

Estimates below are **planning numbers only** — the ceremony is sized from the compiled `.r1cs` (§5.6). EdDSA-Poseidon verify ≈ 4–7k constraints; Poseidon (arity ≤ 5) ≈ 250–400.

### A1 `delivery.circom` — proof of delivery *(MVP, load-bearing core)*

*Statement:* "The recipient committed in `C_S` signed a fresh PoD message bound to the current custodian and to a location inside the committed destination region; the nullifier is correctly derived."

| Public inputs | `shipment_id`, `C_S`, `head`, `nullifier`, `ts` |
|---|---|
| Witness | full `C_S` opening; `pk_blind`, `carrier_pk` (opening of `carrier_pk_commit` inside `head`); recipient EdDSA signature `(R, s)`; `lat_q, lon_q`; depth-6 Merkle path into `dest_region_root` |

Constraints: (1) recompute `C_S` from opening, equate. (2) recompute `head = Poseidon2(Poseidon2(DOM_ACCEPT, shipment_id), carrier_pk_commit)` with `carrier_pk_commit = Poseidon(DOM_PKC, pk_x, pk_y, pk_blind)` opened as witness, equate (nested form, §6.2). (3) derive `cell_RD` from `lat_q/lon_q` (strict decomposition); Merkle-verify into `dest_region_root` with `leaf != PAD`. (4) `m = Poseidon(DOM_PODMSG, shipment_id, carrier_pk_commit, cell_RD, ts)`; `EdDSAPoseidonVerifier(recipient_pk, R, s, m)`. (5) `nullifier == Poseidon(DOM_NULL, shipment_secret)`. (6) range-check `ts` (32 bits).

≈ **10–14k constraints → pot15/16.** Negative tests: wrong recipient key; cell outside region; PAD-leaf membership attempt; tampered `C_S` field; stale-format `ts` overflow; wrong `carrier_pk_commit`.

### A2 `flight.circom` — drone route compliance *(MVP for the drone story)*

*Statement:* "An `N=16`-waypoint telemetry log, digest-signed by the drone key that is this shipment's custodian, lies entirely within `corridor_root`, is time-monotonic and gap-free, respects `ALT_MAX` and the conservative speed bound, starts at the committed origin cell and ends inside the committed destination region, and the committed payload weight is within the method limit."

| Public inputs | `shipment_id`, `C_S`, `head`, `corridor_root`, `t_0`, `t_N` |
|---|---|
| Witness | 16 × `(lat_q, lon_q, alt_dm, t)`; drone EdDSA sig over `d_N`; `carrier_pk` + `pk_blind` (head opening, drone key **is** the custody key); `C_S` opening (for `origin_cell`, `dest_region_root`, `weight_g`, `method`); per-waypoint depth-12 corridor Merkle paths; final-waypoint depth-6 dest-region path |

Constraints, in order: head & `C_S` openings (as A1); `method == 3`; `d_0 = Poseidon(DOM_FLIGHT, shipment_id)` and chained digests; **one** EdDSA verify over `d_N` (digest-then-sign: 1 signature instead of 16 — the key cost optimization); per waypoint: strict decompositions, `cell_RC ∈ corridor_root` (`≠ PAD`), `alt_dm ≤ ALT_MAX`, `t_i > t_{i-1}`, `t_i − t_{i-1} ≤ GAP_MAX` (no log splicing/teleport-by-omission), speed bound §5.5; `cell_RC(w_0) == origin_cell`; `cell_RD(w_15) ∈ dest_region_root`; `weight_g ≤ DRONE_MAX_G` (fallback constant; with A3 stretch, `≤ payload_limit_g` from the credential leaf); export `t_0`, `t_N` as publics.

≈ **55–75k constraints → pot17 (recheck against r1cs; pot18 if over).** Negative tests: one waypoint outside corridor; teleport (Δd > vmax·Δt); time gap > GAP_MAX; non-monotonic t; wrong shipment binding in `d_0` (log reuse across shipments); signature by non-custodian key; overweight payload; altitude bust; PAD-cell membership.

### A3 `credential.circom` — carrier/drone licensing *(stretch layer 1)*

*Statement:* "`carrier_pk_commit` opens to a key whose credential leaf is in the current issuer root, unexpired, with `class == required` (and exports `payload_limit_g` for A2's weight check)." Publics: `carrier_pk_commit`, `cred_root`, `epoch_now`, `class_required`. ≈ 6–8k constraints. Without A3, `accept` is an authorized plain call — carrier *circuit* identity still hidden via `carrier_pk_commit`; only the licensing check is deferred. Negative tests: expired leaf, wrong class, stale root, PAD leaf.

### A4 `handoff.circom` — multi-hop custody *(stretch layer 2)*

*Statement:* "head advances by one dual-signed handoff: the outgoing holder (opened from `head`) and the incoming holder both signed `Poseidon(DOM_HANDMSG, shipment_id, head, ts, cell)`, incoming holder is credentialed, `ts` exceeds the previous head's `ts`." Publics: `shipment_id, head_old, head_new, cred_root, epoch`. Two EdDSA verifies + two head openings ≈ 15–20k. Contract applies via CAS on `head` (I2). Negative tests: fork attempt from stale head, single-signature handoff, self-handoff replay.

### A5 `conditions.circom` — cold-chain telemetry *(stretch layer 3)*

Same digest-then-sign pattern as A2 over `(t, temp_centi)` samples; proves every sample within the `[min,max]` committed in an extended `C_S`, with `GAP_MAX` sampling continuity. Specified for the roadmap; do not build during the hackathon window.

## 10. Contracts (Soroban)

Workspace crates: `poseidon-merkle` (**kept from v1, extended** with fixed-depth padded builders), `aegis-common` (types, DOM tags, encodings — parity-tested), `aegis-registry` (core; gains the `rail` enum, `escrow_of` map, and `release_allowed` view for §6.6), `aegis-credentials`, `aegis-airspace`. The confidential rail adds a **separate** `contracts-ct/` Cargo workspace — the hooked OpenZeppelin token fork plus its verifier/auditor — never merged into this one (different sdk pin and mandatory `stellar contract build`; PIVOT §3.4/§9).

### 10.1 `aegis-registry` interface

```rust
fn init(admin: Address, vks: Map<CircuitId, VerifyingKey>,
        credentials: Address, airspace: Address);          // VKs immutable post-init (I6)

fn create_shipment(merchant: Address, c_s: U256Fr, token: Address, amount: i128,
        milestones: Vec<u16 /*bps, Σ=10000*/>, escrow_deadline: u64,
        method: Method, lane_id: Option<u32>, arbiter: Option<Address>) -> u64;

fn accept(id: u64, carrier: Address, payout: Address,
          carrier_pk_commit: U256Fr, cred_proof: Option<Proof>);   // carrier.require_auth()

fn submit_flight(id: u64, proof: Proof, publics: FlightPublics);   // DRONE only
fn deliver(id: u64, proof: Proof, nullifier: U256Fr, ts: u64);
fn advance(id: u64, proof: Proof, publics: HandoffPublics);        // stretch (A4)
fn refund_expired(id: u64);                                        // permissionless after deadline
fn status(id: u64) -> ShipmentView;                                // opaque fields only
```

### 10.2 Non-negotiable contract invariants (each ships with a test)

- **I1 — Roots come from storage, never from callers.** Every root/`C_S`/`head` appearing in public inputs is read from contract or companion-contract storage and asserted equal before `verify`. A caller-supplied root is a forged-universe proof.
- **I2 — Head is compare-and-swap.** `advance` requires `publics.head_old == stored.head` then writes `head_new`. No custody forks.
- **I3 — Payout is write-once at `accept`.** `deliver` pays only the stored payout; proof submission by third parties is fee donation, not theft (kills front-running structurally).
- **I4 — State machine is total.** Every entrypoint asserts its legal predecessor state(s); `flight_ok` required before `deliver` iff `method == DRONE`.
- **I5 — Nullifier map is persistent, check-then-set in the same invocation**, TTL extended on every touch. Soroban archival semantics make eviction fail-closed (an archived entry aborts the tx until restored, and restoration restores the *spent* value) — document, don't rely on luck: bump TTLs on every state write, ≥ escrow horizon.
- **I6 — VKs immutable after `init`.** New circuit ⇒ new deployment (v1's exact posture). Governance/upgrade is roadmap.
- **I7 — Milestone math in integers**: shares in bps sum to exactly 10 000 (asserted at create); payout per milestone = `amount × bps / 10000`; the final milestone receives `amount − Σ paid` so rounding dust cannot strand.
- **I8 — Checks → effects → interactions**: state written before `token.transfer` out. (Soroban currently blocks reentrancy; order defensively anyway.)
- **I9 — Freshness windows on-chain, not in-circuit**: `deliver` enforces `|ledger_time − ts| ≤ 600 ∧ ts > accept_ts`; `submit_flight` enforces `t_N` window and `t_0 ≥ accept_ts`. Circuits cannot see the clock; contracts can.
- **I10 — Events are opaque**: emit `(id, new_state, head/nullifier)` only. No amounts beyond what the token contract already reveals, no cells, no commitments' openings.

### 10.3 `aegis-credentials` / `aegis-airspace`

Thin authorized-root stores: `set_root(root, epoch)` with `issuer.require_auth()` / `approve_corridor(lane_id, root, valid_from, valid_to)` with `authority.require_auth()`; getters return current values which `aegis-registry` reads server-side (I1). Both reuse the v1 pattern of `require_auth`-gated single-writer state (the hardening v1 shipped as "Limitation 0 — CLOSED").

## 11. Delivery methods

| | COURIER | LOCKER | DRONE |
|---|---|---|---|
| Custody | accept (+A4 hops, stretch) | accept | accept; drone key = custody key |
| Extra gate | — | — | **A2 flight proof** |
| PoD signer | recipient PWA | recipient PWA at locker cell | recipient PWA at hover/drop cell |
| Trust anchor | recipient key | locker cell = fixed known RD cell | drone attestation key (§4) |

### 11.1 Common PoD interface

One circuit (A1) serves all three methods — method differences live in *gating* (I4), not in duplicated cryptography. Fewer circuits, fewer ceremonies, fewer bugs.

### 11.2 Corridor authoring (`prover/src/authority.ts`)

GeoJSON polyline → buffered polygon → RC-cell cover → depth-12 padded Poseidon tree → `approve_corridor`. Emits a `corridor.json` (cells + root) that the dashboard renders and the drone simulator loads. Deterministic and unit-tested against a fixture route (the demo lane).

### 11.3 Drone simulator (`prover/src/dronesim.ts`) — labeled honestly, used adversarially

Software "secure element": generates the attested keypair, flies a route, emits the signed telemetry log. Modes: `honest`, and attack modes that MUST each fail proof generation or contract verification, wired into CI as negative e2e tests: `--attack stray` (exits corridor), `--attack teleport` (speed-bound breach), `--attack gap` (sample dropout), `--attack splice` (reuse a log from another shipment id), `--attack heavy` (overweight), `--attack foreign-key` (signs with a non-custodian key). The demo video shows `honest` succeeding then `stray` being rejected — that contrast *is* the pitch.

## 12. Threat model — loophole audit

Every row names its enforcement point and its test. A row without a passing test is an open item, not a mitigated threat.

| # | Attack | Countermeasure | Enforced at | Test |
|---|---|---|---|---|
| T1 | Proof replay across shipments | `shipment_id` public in every circuit; all message/digest domains include it | A1/A2/A4 | `replay_cross_shipment` |
| T2 | Proof replay across deployments/networks | All publics asserted against *this* contract's storage (I1); state advances make replays inert | registry | `replay_foreign_state` |
| T3 | Front-run `deliver`/`submit_flight` to steal payout | Payout write-once at accept (I3); submitter irrelevant | registry | `frontrun_deliver` |
| T4 | Groth16 proof malleability (re-randomization) | State transitions + nullifier make any re-submission a no-op | registry | `remalleated_proof_noop` |
| T5 | GPS spoof / simulated flight | **Trust-anchored, not solved** (§4): attested keys now; OSNMA, witness beacons, stake — roadmap. Stated in README | — | n/a (documented) |
| T6 | Drone key extraction / operator forges telemetry | Same anchor as T5 + credential revocation (next epoch root) | credentials | `revoked_key_rejected` (A3) |
| T7 | Replay an old *honest* flight log | `d_0` binds `shipment_id`; `t_0 ≥ accept_ts`, `t_N` freshness window (I9) | A2 + registry | `splice`, `stale_flight` |
| T8 | Steal/pre-collect a recipient PoD signature | PoD message binds `carrier_pk_commit` + cell + ts; useless to any other custodian/place; window bounds staleness | A1 + registry | `stolen_pod_sig` |
| T9 | Recipient key phishing/loss | Key lives in claim-link PWA; rotation = merchant re-creates shipment (funds still escrowed). Documented UX limitation | — | n/a |
| T10 | Custody fork / parallel handoffs | Single stored head, CAS (I2) | registry | `fork_head` |
| T11 | Carrier accepts then vanishes | `escrow_deadline` → permissionless `refund_expired`; carrier bonds/slashing roadmap | registry | `timeout_refund` |
| T12 | Merchant commits garbage `C_S` (wrong region/weight) to trap carrier | Carrier verifies full opening off-chain before `accept` (§8.2); packet-verify is in the carrier CLI, on by default | carrier CLI | `packet_mismatch_warns` |
| T13 | Padding-leaf "membership"; empty-tree tricks | `leaf != PAD` constrained in every membership gadget | circuits lib | `pad_membership` |
| T14 | Field wraparound in comparisons/products | Strict bit decomposition to declared widths before every cmp/mul; ≤62-bit factors | circuits lib | `overflow_probe` |
| T15 | Unconstrained witnesses / rank bugs | `circom --inspect` clean in CI; every intermediate feeding a public is constrained; negative-test-per-row discipline | CI | `inspect_gate` |
| T16 | Trusted-setup toxic waste | v1 posture: dev ceremony, published artifacts + `zkey verify` repro steps; MPC roadmap | docs | `zkey_verify_repro` (doc'd) |
| T17 | Issuer/authority key compromise | Single-writer `require_auth` roots; epoch rotation limits blast radius; multisig roadmap | cred/airspace | `unauthorized_root` |
| T18 | Timing/graph deanonymization on-chain | Known leak (§13): fresh Stellar addresses per role, coarse `escrow_deadline`, opaque events (I10); batching/shielded pool roadmap | design | n/a (documented) |
| T19 | Fee-source doxxing | Optional fee-bump/sponsored relayer; harmless because of I3 | ops | n/a |
| T20 | Milestone rounding dust / bps mismatch | Σbps==10000 asserted; remainder-to-final (I7) | registry | `milestone_dust` |
| T21 | Nullifier eviction via state archival | Fail-closed archival + TTL bumps on every write (I5) | registry | `ttl_bump_on_write` |
| T22 | Stale credential/corridor roots in proofs | Contract passes only *current* stored roots as publics (I1) | registry | `stale_root_rejected` |

Confidential-rail rows **T23–T29** live with their mechanism in §6.6 and are equally test-mandatory.

## 13. Privacy analysis — who learns what

| Observer | Learns | Never learns |
|---|---|---|
| Public chain | Shipment count/ids, escrow **token + amount** on the transparent rail / **token only — amount hidden** on the confidential rail (§6.6), method enum, `lane_id` (coarse regulator-published route class), state-transition **timing**, merchant funding address, carrier accept + payout addresses, opaque `C_S`/`head`/nullifier | Contents, qty, weight, value beyond escrow amount, recipient identity/address, exact route, sensor data, carrier *circuit* identity |
| Merchant | Everything about own shipment | Carrier's other shipments |
| Carrier | Packet contents it was sent; recipient region (needs it to deliver); exact address only at the last mile (off-chain, from packet) | Merchant's other flows |
| Recipient | Own packet | Carrier's credential details |
| Issuer/authority | Licensee set / lane geometry | Which shipments any licensee carries |

**Stated leaks + dials:** on the transparent rail the escrow amount correlates with value (mitigate: standard denominations; fix: switch the shipment to the confidential rail, §6.6 — whose own residual leaks are the merchant's public aggregate `deposit`s and the regulator-auditor's full amount visibility, both by design); addresses link roles across shipments (mitigate *now*: fresh Stellar keys per shipment per role — the demo does this and the README says so); `lane_id` reveals corridor class by regulatory design; timing correlates create/deliver (mitigate: coarse deadline, roadmap: batching windows). Under-claiming is worse than the leak — enumerate these in the README's Honest Limitations.

## 14. Performance & cost budget (verify empirically; these are planning numbers)

| Circuit | Est. constraints | ptau | Prove (node/rapidsnark-class) | Verify on-chain |
|---|---|---|---|---|
| A1 delivery | 10–14k | pot15/16 | seconds | 1 × CAP-0074 verify + a handful of CAP-0075 hashes + storage — same cost class as v1 `attest`, which is already live |
| A2 flight (N=16) | 55–75k | pot17 (re-measure) | tens of seconds | same class |
| A3 credential | 6–8k | pot14/15 | seconds | same class |

Groth16 publics stay ≤ 6 per circuit by design (hash-bundling not needed). If A2 proving in-browser is too slow, prove via the node CLI — the dashboard's `/carrier` view can shell to the same `/api` relayer pattern v1 already ships (with v1's "0b" caveat about open relayers copied into the README).

## 15. Hackathon mapping

**Submission requirements** (per DoraHacks listing): open-source repo ✔ (the fresh `aegis-relay` repo; v1 donor linked as provenance), demo video ✔ (shot list in PIVOT §10), ZK load-bearing ✔ (§1 argument, three statements each impossible without ZK), on-chain component on Testnet ✔ (registry + companions deployed; explorer links in README like v1).

**Judging pitch, one paragraph:** v1 proved solvency without revealing balances; Aegis Relay proves *movement* without revealing the map. Same platform-native trick — CAP-0074/0075 make verify-and-settle a single atomic Soroban call — applied to a domain where the secrets (routes, recipients, manifests) are physically dangerous to leak, with a drone corridor proof as the marquee demonstration that a machine can *prove it obeyed the rules of the sky without telling anyone where it flew*.

**Demo script (≤ 3 min):** (1) Merchant creates + funds — explorer shows only opaque commitment. (2) Carrier accepts; dashboard `/track` shows state timeline, all fields redacted. (3) `dronesim honest` flies the lane; map shows the corridor publicly and the true route *only* on the carrier's own view, watermarked "visible only to you"; `submit_flight` verifies on-chain. (4) Recipient PWA taps to sign; `deliver` releases escrow in the same tx — show the transfer; on the confidential rail (R3) the same settlement lands with **no amount on the explorer**, then the auditor console decrypts it — private to the world, transparent to the regulator. (5) The kicker: `dronesim --attack stray`, proof fails / contract rejects; badge stays red — plus a hook-blocked premature settle if R3 shipped. (6) 15 s on Honest Limitations (incl. the unaudited confidential-token preview, T29).

## 16. Roadmap (post-hackathon)

A4 multi-hop custody → A5 cold chain → MPC ceremony → confidential-rail hardening (spender-delegation escrow, multi-milestone sub-accounts, immutable verifier VKs — §6.6, PIVOT §12) → attempted-delivery griefing proofs → issuer/authority multisig + view-key selective disclosure for arbiters (continues v1's compliance thesis) → BLS12-381 migration → real secure-element integration (OSNMA-authenticated GNSS) → SCF Build Award application with `poseidon-merkle` + the geocell/corridor toolkit as the reusable ecosystem primitives.

---

*Companion: `PIVOT.md` translates this spec into a clock-aware execution plan with cutlines and carries the verified reuse audit. Where the two disagree, this document wins on protocol semantics; that one wins on scope sequencing.*
