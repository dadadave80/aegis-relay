# PIVOT.md — Aegis v1 (Proof-of-Reserves) → Aegis Relay

**Agent execution playbook + verified reuse audit.** `DESIGN.md` is the normative spec; this file says what carries over from v1, what gets adopted from third parties, and how the work is sequenced against a hard clock. Where the two disagree, DESIGN.md wins on protocol semantics; this file wins on scope sequencing.

## 0. Mission and hard constraints

- **Deadline: 2026-07-03 17:00:00 UTC** (verified from the DoraHacks page source, epoch 1783098000; extended from June 29). T0 = 2026-07-02 13:18 UTC ⇒ ~27.7 usable hours; cutline budgets below keep their T+N shape with T0 fixed at that mark.
- **Do not switch the Aegis proving toolchain.** Circom 2.1.6 + snarkjs + Groth16/BN254 is proven end-to-end in the v1 repo (live testnet verifier, Poseidon parity tests, encoders). The sunk substrate IS the competitive advantage (§2).
- **Two proving stacks will coexist and must never be merged** (§3): Aegis circuits stay circom/Groth16/BN254/Baby-Jubjub/Poseidon; the adopted OpenZeppelin confidential token brings its own Noir/UltraHonk/Grumpkin/Poseidon2 stack, consumed strictly as a black-box contract + client SDK. Any attempt to "unify" them is a cut-immediately rabbit hole.
- **No hackathon submission exists yet** (human-confirmed). There is nothing to preserve or edit on DoraHacks — a fresh BUIDL gets filed for Aegis Relay. The v1 repo is a read-only donor, never modified.
- **Every threat row in DESIGN §12 (and the confidential-rail rows in DESIGN §6.6) marked with a test name must have that test.** Negative tests are not optional; a circuit or hook without its adversarial tests is not "done" at any cutline.
- ⚠️ marks ask-the-human checkpoints — pause and surface; do not guess.

## 1. Fallback ladder (decide-by clock, not by hope)

Ship the highest rung fully working rather than a higher rung half-working. Each rung is independently submittable.

| Rung | Contents | Decide by |
|---|---|---|
| **R1 (floor)** | COURIER only: A1 delivery circuit + registry (create/accept/deliver/refund, transparent-XLM escrow) + escrow release + minimal `/track` + testnet deploy + video | T+10h: A1 e2e green on localnet ⇒ R1 banked |
| **R2 (target)** | R1 + DRONE: A2 flight circuit, airspace contract, corridor authoring, dronesim attack modes, map view | T+18h: not e2e-green ⇒ freeze as "designed + circuit-tested, not deployed", polish R1 |
| **R3 (headline stretch)** | **Confidential escrow rail** via OpenZeppelin Confidential Token (§3): amounts hidden on-chain, regulator-auditor decryption, selective disclosure for disputes. Internal ladder CT-A → CT-B → CT-C (§3.5) | Start only after G2 banked; pick CT level by hours remaining per §3.5 |
| **R4 (stretch)** | A3 credential proof at accept | Only if R3 (any CT level) banked with ≥3h left |
| **R5 (vanity)** | A4 multi-hop, A5 conditions | Do not attempt. Roadmap. |

R3 outranks the old credential stretch because it closes the design's biggest stated privacy leak (escrow amounts, DESIGN old-NG1) and produces the strongest judging beat: *the chain sees neither what's shipped nor what it's worth.*

## 2. Reuse audit — verified, not remembered

Audited by full clone and file-by-file read of `dadadave80/aegis-zk-proof-of-reserves` @ `main` (`20791e6`, 2026-07-02). Human directive honored: total pivot; all Markdown discardable; libraries/primitives reused only on the merits.

### 2.1 Verdict

**Neither fully fresh nor in-place: transplant four organs into a fresh skeleton; greenfield everything else.** The repo has two non-competing layers. The **product layer** — what the proofs say, the contract's business semantics, the circuit statement, all four Markdown files, the PoR naming — is 100% discarded. The **substrate layer** — how BN254 field elements, curve points, and Poseidon hashes move identically between circom, snarkjs JSON, TypeScript, and Soroban host functions — is product-agnostic, live-testnet-proven, ~750 lines, and encodes 100% of the cross-system encoding knowledge. Rebuilding it costs an estimated **7–11h** (constants + parity re-debugging 3–5h; Groth16 pairing/encoding re-derivation 2–4h; snarkjs→ScVal serialization 1–3h; CI/workspace ~1h) — 30–45% of the remaining budget, buying zero differentiation, since the encodings are dictated by soroban-sdk and snarkjs, not by the old product. Honest counterweight: **~70% of Relay is new code regardless** (the repo has no EdDSA, no geospatial code, no escrow/token handling, no state machine, no encryption); transplants don't shrink the new work, they remove the silent-failure debugging that gates it.

### 2.2 Ground-truth inventory (51 tracked files)

The complete Markdown set is four READMEs (root, circuits, prover, dashboard). No `.claude/`, no `CLAUDE.md`, no skill files are tracked — anything beyond these four lives only in the local working copy and is equally discardable.

| Asset | Lines | Verdict |
|---|---|---|
| `contracts/poseidon-merkle/` | 496 | **TRANSPLANT** (extend, don't break) |
| `contracts/por-verifier/src/groth16_verifier.rs` | 84 | **TRANSPLANT** (parameterize VK) |
| snarkjs→Soroban encoders (`gen/gen-fixtures.ts`; helpers in `prover/src/index.ts` and `dashboard/lib/prove.ts`) | ~120 × 3 proven copies | **TRANSPLANT** into one shared module |
| `ci.yml`, Cargo workspace, `rust-toolchain.toml`, `.gitignore`, fixtures pattern | ~90 | **TRANSPLANT** (edit targets) |
| `por-verifier/src/{lib,reserve,test}.rs` | ~350 | **HARVEST PATTERNS**, delete semantics |
| `prover/src/tree.ts` | 114 | **HARVEST** (base of padded-tree builders) |
| `prover/src/{index.ts main flow, ledger.ts}` | ~350 | RETIRE (keep tx-submission pattern) |
| `circuits/por.circom` + tests | 268 | RETIRE (keep 2 conventions + 1 pinned vector) |
| `dashboard/` app/pages/components/lib | ~900 | RETIRE from critical path (§2.4 optional harvest) |
| All four `*.md` | — | **DO NOT COPY** — write fresh in the new repo (§2.5) |

### 2.3 The four transplants — pros, cons, adaptation notes

**`poseidon-merkle` crate (the crown jewel).** `poseidon2(env,a,b)` implemented directly on `crypto_hazmat().poseidon_permutation` with the full HorizenLabs/hadeshash BN254 x5_254_3 constant tables inlined (3×3 MDS + 195 round constants as byte arrays), parity-pinned against the circomlibjs vector; `merkle.rs` adds build/gen/verify with an explicit even-index-is-left convention, zero-leaf padding `poseidon2(0,0)`, and an honest `# Safety` note on the absence of leaf/internal domain separation. Zero PoR coupling in 496 lines; the constant tables are the single most error-prone artifact in the stack and they are already transcribed and pinned. **Adaptations:** (a) arity-2 only — do NOT add new constant tables; nest the custody head as `head = poseidon2(poseidon2(DOM_ACCEPT, shipment_id), carrier_pk_commit)`, mirrored in-circuit (C_S is never recomputed on-chain, so wide arities are circuit-side where circomlib provides them); (b) the crate's `poseidon2(0,0)` is the canonical `PAD` everywhere — DESIGN's `Poseidon(DOM_EMPTY)` is amended to it; (c) add fixed-depth padded builders additively.

**`groth16_verifier.rs`.** Groth16 verification hand-assembled from BN254 host primitives: vk_x via `g1_mul`/`g1_add`, `−proof.a`, one 4-pair `pairing_check([−A, α, vk_x, C],[B, β, γ, δ])`; VK baked as generated consts + IC-length check. Circuit-agnostic except the VK. **Adaptation:** lift the VK into per-circuit values supplied at `init` (DESIGN I6), keep `verify_proof(vk, proof, publics)` pure. (Accuracy note now reflected in DESIGN: there is no single "Groth16 verify host fn" — the verifier is *built from* the BN254/Poseidon host primitives.)

**The encoding Rosetta stone.** Three independently consistent copies document: `Bn254G1Affine = BE32(x)‖BE32(y)`; `Bn254G2Affine = BE32(x_c1)‖BE32(x_c0)‖BE32(y_c1)‖BE32(y_c0)` — imaginary limb FIRST, the inverse of snarkjs's `[[x_c0,x_c1],…]` order — plus decimal→U256 ScVal. The G2 limb swap is *the* classic multi-hour Stellar-ZK footgun, already solved and testnet-validated. **Adaptation:** consolidate into `prover/src/lib/bn254.ts`, one copy under test. `gen-fixtures.ts` additionally is the proof/VK→Rust-fixture generator — reuse per circuit so contract tests never need a live prover.

**CI + workspace glue.** cargo test + `wasm32v1-none` release job and the bun job carry over with path edits; add the circuit `--inspect` gate and negative-suite as extensions. Workspace `Cargo.toml` (soroban-sdk **26.1.0**, `hazmat-crypto`), toolchain file, `.gitignore` (already excludes zkeys/wasm) unchanged.

### 2.4 Harvest-and-retire notes

From `por-verifier` business logic, read-once-while-writing: issuer `require_auth()` before state, instance-TTL bump constants (100k/500k) on every write (DESIGN I5's mechanism, already implemented), `contracterror`/`contractevent` shapes, constructor config with explicit panic on unimplemented paths, `[U256 → Bn254Fr]` public-signal assembly. `tree.ts` becomes the corridor/dest-region/credential padded-tree builder with the leaf formula swapped. Dashboard: if P5 happens at all, copy `lib/contract.ts` RPC wiring, the `prove.ts` server-side-proving route pattern (with committed `public/proving/*` serving), and four generic components (`Timeline`, `StatusBadge`, `Hash`, `StepFlow`); never port pages. **Critical negative finding:** `circuits/package.json` has **no build scripts** — compile/ptau/zkey commands exist only inside the READMEs being deleted, and CI deliberately excludes circuits (zkey/wasm gitignored). The "pipeline" is knowledge, not code: `build.mjs` is greenfield, and the §9 gotchas must land in the regenerated docs or they are gone.

### 2.5 Markdown disposition and execution shape

None of the four v1 Markdown files are copied. Write `README.md` (from DESIGN §1/§15, with a new Honest Limitations section — the culture survives, zero sentences do) and `CLAUDE.md` (architecture, §9 gotchas, §8 guardrails) fresh in the new repo's first commits — an agent in a doc-less repo re-derives context badly, and the §2.4 finding means the circuit-pipeline knowledge exists *only* in docs. **Execution shape — chosen because no hackathon submission was ever filed (human-confirmed), which voids any keep-the-BUIDL-link argument: a separate project — new folder, new repo `aegis-relay` — bootstrapped by copying the §2.2 transplant sets out of the untouched v1 checkout at t=0.** The v1 repo stays a read-only donor and a provenance link in the README. Weighed against the alternatives: with the transplants carried in it pays none of the 7–11h greenfield tax, and with no BUIDL to preserve it now strictly beats in-place branch surgery — no selective-deletion churn, a git history that tells one coherent story from commit one, and zero PoR residue anywhere a judge or agent looks.

## 3. Adopted dependency — OpenZeppelin Confidential Token (escrow amounts go dark)

Verified by full clone of `brozorec/stellar-confidential-token-demo` (@ `8b34def`, 2026-07-02) and of the protocol it wraps, OpenZeppelin `stellar-contracts` branch `feat/confidential-verifier-ultrahonk` (demo validated at rev `539968f`).

### 3.1 What it is (facts, not brochure)

Balances are Pedersen commitments on **Grumpkin**; every state transition carries an **UltraHonk** (Noir) proof verified on-chain via Nethermind's `rs-soroban-ultrahonk`. Each account holds a **spendable** and a **receiving** balance; ops are `register` (bind Grumpkin keys; proof), `deposit` (public SEP-41 → receiving; **public amount**), `merge` (fold receiving→spendable), `withdraw` (→ public; proof), `confidential_transfer` (spendable → recipient's receiving; **amount hidden**; proof). Every transfer emits **dual auditor ciphertexts** (a registered auditor key can decrypt amounts) and the SDK ships off-chain **selective disclosure** (holder proves one amount of one transfer to one designated receiver). Browser/node proving ≈1s via bb.js; prebuilt contract wasms and pinned VKs ship in `packages/sdk`; contracts are already deployed on testnet. `from.require_auth()` on transfers; recipients must be `register`ed (`AccountNotRegistered = 3501`). Explicitly **unaudited / not production ready** — this lands verbatim in Honest Limitations.

**Why it fits Aegis:** it deletes the largest stated leak (escrow token **amount**, old DESIGN NG1/T18) and its auditor + disclosure channels are exactly Aegis's regulator/arbiter selective-disclosure thesis, shipped. Bonus narrative symmetry: v1's `poseidon-merkle` was written OpenZeppelin-PR-shaped; Relay now also *consumes* OpenZeppelin — both directions of the ecosystem story.

### 3.2 The load-bearing extension point (verified in source)

The OZ `ConfidentialToken` trait has `type Hooks`; the demo instantiates `type Hooks = NoHooks`. The `Hooks` trait (`packages/tokens/src/confidential/mod.rs:142`) exposes default-no-op methods invoked **after auth/decode, before proof verification and balance updates** — i.e. a panicking hook aborts the operation and cannot be bypassed:

```
on_register(e, account, auditor_id, payload)
on_deposit(e, from, to, amount: i128)
on_merge(e, account)
on_withdraw(e, from, to, amount: i128, payload)
on_transfer(e, from, to, payload)
on_spender_transfer(e, spender, from, to, payload)
```

Hooks are **pure contract logic**: implementing them changes no circuits, no VKs, no proofs. An Aegis instance of the token is therefore a ~40-line Rust fork of the demo's `contracts/token` swapping `NoHooks` for `AegisEscrowHooks` — no Noir, no bb, no new ceremonies.

### 3.3 CT-A design — the hook-caged per-shipment escrow account

The insight: with hooks, **key possession stops being spending authority**. Escrow keys become mere proof-generation capability; authorization lives in the hook + registry state.

- **Deploy** Aegis-owned instances: `aegis-ct-token` (hooked fork), `verifier` (register the shipped `*.vk.bin` set), `auditor` (auditor_id 0 = mock-regulator Grumpkin key). Underlying = native XLM SAC (exact-transfer semantics required — XLM SAC satisfies it). Registry stores the token address at `init`; the token stores the registry address at construction.
- **Fund (merchant, once):** `register` → `deposit` (public amount — this is the merchant's aggregate float across shipments, not a per-shipment figure; state this leak honestly) → `merge`.
- **Create (per shipment):** merchant CLI generates escrow account **E** (fresh Stellar keypair + Grumpkin keys), `register`s E, `confidential_transfer(merchant→E, amount)` (**amount hidden from here on**), triggers E's `merge`. `create_shipment(..., rail=Confidential, escrow_addr=E, refund_addr)` writes the registry's `escrow_of(E)=id` map; **no funds enter the registry** on this rail. The shipment packet additionally carries E's Stellar secret, Grumpkin keys, and the transfer opening `(v, r)` — the carrier decrypts E's balance and **verifies escrow ≥ agreed price against the on-chain commitment before accepting** (extends the T12 packet-verify step to funds).
- **AegisEscrowHooks rules** (evaluated only when `registry.escrow_of(from)` is `Some(id)`; all other accounts unaffected):
  - `on_withdraw`: **always panic** — escrow funds can never exit to the public rail.
  - `on_transfer(from=E, to)`: allow iff `registry.release_allowed(id, to)` — `DELIVERED ⇒ to == stored payout`; `EXPIRED ⇒ to == stored refund_addr`; anything else panics.
  - `on_spender_transfer` with `from=E`: panic (escrows never delegate).
  - `on_register`: enforce `auditor_id == 0` (approved-regulator policy) — one line, big compliance beat.
- **Settle:** carrier calls `registry.deliver(...)` (Groth16 A1 verified exactly as on the transparent rail; state → DELIVERED, nullifier spent), then submits `confidential_transfer(E→payout)` signed with E's key from the packet; the hook cross-calls the registry and admits it. **Verify-then-settle in two txs** — each atomic, ordering enforced by the hook, and no window of theft exists between them because E is caged. This is an honest delta from the transparent rail's single-tx verify-and-settle; DESIGN §6.6 states it.
- **Refund:** after `escrow_deadline`, `refund_expired()` flips state → EXPIRED (no token transfer on this rail); merchant uses its packet copy of E's keys to `confidential_transfer(E→refund_addr)`; hook admits it.
- **Constraints v0:** confidential rail is single-milestone `[10000]` only (the registry never learns the amount, so bps math is impossible); multi-milestone stays transparent-rail-only.

### 3.4 Confidential-rail threat & gotcha rows (each with a named test; full table in DESIGN §6.6)

Premature release / key-holder griefing → hook state-gate (`hook_premature_release`, `hook_wrong_dest`). Escrow exit to public rail → `on_withdraw` panic (`hook_withdraw_blocked`). Registry↔token address spoof (running escrow on an unhooked instance) → both addresses pinned at init/construction, packet-verify checks the token id (`pinned_token_addr`). Opening loss → the protocol's `(v,r)` secrets live only in **events and RPC serves ~7 days**; openings MUST persist in the packet and CLI `out/` (`opening_persistence` doc-test). Auditor master key = full amount visibility → deliberate regulator design, Honest Limitation. Verifier VK mutability → demo gates `update_verification_key` behind a `manager` role; deploy with manager = deployer key and flag in limitations (immutable/multisig is roadmap). Unaudited UltraHonk backend + circuits → verbatim README warning in limitations. `stellar contract build` (stellar-cli ≥ 25.2.0) is **mandatory** for the token workspace — plain `cargo build` fails on the transitively-enabled `experimental_spec_shaking_v2` feature. soroban-sdk skew: demo pins 26.0.0, Aegis 26.1.0 — same line; keep the token in its own sub-workspace (`contracts-ct/`) exactly like the demo does, don't force one lockfile. **Gate G-CT0 (first 20 min of R3):** `pnpm install && pnpm build:sdk && pnpm deploy:contracts && pnpm e2e` green against testnet from the demo repo unmodified; if that fails, R3 drops to CT-C immediately.

### 3.5 Internal ladder for R3 (attempt top, degrade down)

| Level | What ships | Est. | Prereq |
|---|---|---|---|
| **CT-A** | Full §3.3: hooked token fork + registry escrow map + caged E lifecycle + CLI (`prover/src/confidential.ts` on `@ctd/sdk`) + auditor console beat + negatives | 7–10h | G2+G3 banked with ≥9h left |
| **CT-B** | Hooked token, no E account: pay-on-delivery `confidential_transfer(merchant→payout)` admitted by hook only on DELIVERED; escrow *guarantee* falls back to a small transparent XLM deposit; amount of the real payment hidden | 4–5h | ≥5h left |
| **CT-C** | Demo's already-deployed testnet instances used as the payment rail + auditor/disclosure demo beats; registry untouched | 1–1.5h | ≥1.5h left |

At every level the video gets the beat: explorer shows the settlement with **no amount**, then the auditor console decrypts it — "private to the world, transparent to the regulator."

## 4. Target repository layout

```
aegis-relay/                            (new repo — fresh folder beside the v1 checkout)
├── circuits/                           # circom/Groth16 — UNCHANGED STACK
│   ├── lib/{constants,geocell,merkle_fixed,log_digest,safe_cmp}.circom
│   ├── delivery.circom  flight.circom  credential.circom(stretch)
│   ├── build.mjs                       # greenfield (see §2.4 finding)
│   └── test/
├── contracts/                          # Aegis Cargo workspace (soroban-sdk 26.1.0)
│   ├── poseidon-merkle/                # transplanted
│   ├── aegis-common/  aegis-registry/  aegis-credentials/  aegis-airspace/
│   └── (registry gains: escrow_of map, release_allowed view, rail enum — §3.3)
├── contracts-ct/                       # SEPARATE workspace, fork of demo `contracts/` (R3)
│   ├── token/                          # type Hooks = AegisEscrowHooks
│   ├── verifier/  auditor/             # as demo; VKs from @ctd/sdk pinned set
│   └── (build with `stellar contract build` ONLY — §3.4)
├── prover/
│   └── src/
│       ├── lib/{bn254,poseidon,encoding,constants,packet}.ts   # bn254 = consolidated Rosetta stone
│       ├── merchant.ts  carrier.ts  dronesim.ts  authority.ts  issuer.ts(stretch)
│       └── confidential.ts             # R3: @ctd/sdk driver — register/fund E/settle/refund/audit
├── dashboard/                          # optional P5; harvest per §2.4
├── docs/                               # DESIGN.md, PIVOT.md, packet.md, demo-script.md
└── .github/workflows/ci.yml
```

## 5. Phased execution plan (T0 = 2026-07-02 13:18 UTC; budgets include their own testing)

**Step 0 (before anything):** bootstrap the separate project. The v1 checkout is donor material only — never modified.

```bash
V1=/Users/dadadave/Dev/Stellar/stellar-hacks-zk
mkdir aegis-relay && cd aegis-relay && git init -b main
mkdir -p contracts prover/src/lib .github/workflows
cp -r "$V1"/contracts/poseidon-merkle            contracts/
cp    "$V1"/contracts/por-verifier/src/groth16_verifier.rs contracts/   # staging; lands in aegis-registry in P2
cp    "$V1"/contracts/por-verifier/gen/gen-fixtures.ts     prover/src/lib/
cp    "$V1"/prover/src/index.ts  prover/src/lib/_v1-encoders.ts   # harvest toBE32/encodeG1/encodeG2/u256 → bn254.ts in P1, then delete
cp    "$V1"/prover/src/tree.ts   prover/src/lib/
cp    "$V1"/Cargo.toml "$V1"/rust-toolchain.toml "$V1"/.gitignore .
cp    "$V1"/.github/workflows/ci.yml .github/workflows/
git add -A && git commit -m "transplant proven BN254/Poseidon substrate from aegis v1 (provenance in README)"
```

⚠️ Ask the human once: GitHub owner/visibility for the new `aegis-relay` repo (create + push), and **register the stub DoraHacks BUIDL now** — no submission exists yet and BUIDLs are editable until the deadline, so filing early turns the T-0 submission into an edit instead of a scramble. Default if unreachable: work local-only until P6, then surface again.

- **P0 — Safety + scaffold (T0→T+1h).** Step 0 bootstrap; prune the copied `Cargo.toml` workspace members to crates that exist; skeletons compile empty; CI green (push once the ⚠️ repo exists). **G0:** `cargo build --target wasm32v1-none --release` + `bun install` succeed.
- **P1 — Shared truth layer (T+1h→T+3h).** `aegis-common` + `circuits/lib/constants.circom` + `prover/src/lib` with DESIGN §5 constants/encoders (nested-head form, PAD = `poseidon2(0,0)`); extend the parity test to byte-identical Poseidon outputs across Rust host-fn, circomlibjs, and circuit witnesses for EVERY §5.2 structure. **G1:** parity green. *Nothing downstream starts before G1.*
- **P2 — Rung R1 (T+3h→T+10h).** Gadgets (`pad_membership`, `overflow_probe`); `delivery.circom` + `--inspect` clean + pot sized from `.r1cs` + all six negatives; `aegis-registry` (I1–I10, transparent rail, plus the rail enum and §3.3 escrow map stubs behind a feature so R3 bolts on without interface churn) porting the verifier + patterns; `merchant.ts`/`carrier.ts`; localnet e2e incl. replay-no-op and timeout-refund. **G2 (decide-by T+10h):** COURIER e2e green. Slip past T+12h ⇒ ⚠️ alert human: scope is R1-only; remaining hours go to P6–P7.
- **P3 — Rung R2 drone (T+10h→T+16h).** `aegis-airspace` + `authority.ts` fixture lane; `flight.circom` (N=16) + nine negatives; `dronesim.ts` honest + six attack flags, each a CI e2e negative; `submit_flight` gating (I4/I9, corridor root from storage I1); DRONE e2e + deliver-before-flight revert. **G3 (decide-by T+18h):** DRONE e2e green, else freeze per ladder.
- **P4 — Rung R3 confidential escrow (parallel-start at T+11h if G2 banked; own gates).** G-CT0 smoke (§3.4, 20 min, fail ⇒ CT-C). Then per §3.5 level: fork+build `contracts-ct` (hooks + tests `hook_premature_release`, `hook_wrong_dest`, `hook_withdraw_blocked`, `pinned_token_addr`); registry escrow map + `release_allowed`; `confidential.ts` E-lifecycle on `@ctd/sdk` (node json-store, not browser); e2e: fund→create→accept(balance-verify)→deliver→hook-admitted settle→auditor decrypt; refund path; premature-settle negative. **G4:** chosen CT level e2e green on testnet (the demo stack is testnet-native; don't fight localnet for it).
- **P5 — Surfaces (T+16h→T+20h).** Per §2.4 harvest: `/track/[id]` opaque timeline + escrow badge ("amount: confidential" when rail=CT), `/merchant`, `/carrier` (relayer with v1's "0b" caveat verbatim), `/claim/[link]` PWA (circomlibjs keygen + PoD signing), corridor/route map with the "visible only to you" watermark. Plain > polished. **G5:** a stranger can click through the README quickstart.
- **P6 — Testnet + docs (T+20h→T+22h).** Deploy all Aegis contracts (+ `contracts-ct` per CT level) with fresh keys per role; run happy paths + one on-chain rejected `--attack stray` tx (+ one hook-rejected premature settle if CT-A/B); regenerate README per §2.5 with Contract IDs/explorer/tx hashes and Honest Limitations covering: DESIGN §4 trust anchors verbatim, dev-ceremony posture + `zkey verify` repro, §13 stated leaks (incl. deposit-amount and auditor-omniscience from §3), the **unaudited UltraHonk** warning verbatim, VK-manager mutability. **G6:** every README command copy-pastes clean on a fresh clone.
- **P7 — Video + submission (T+22h→deadline; never compress below 90 min).** Shot list §10. Update the BUIDL per the Step-0 ⚠️ decision; submit; re-open as a judge and click every link.

## 6. Task-level notes the agent must not re-derive

- Circuit publics exactly as DESIGN §9; the registry constructs the public-input vector from storage (I1); callers supply proof bytes + the few caller-known publics (`nullifier`, `ts`, `t_0`, `t_N`).
- Custody head uses the **nested arity-2 form** (§2.3a) in all three languages; `PAD = poseidon2(0,0)` everywhere; parity-tested.
- `U256Fr` representation unchanged from v1 across the contract boundary; do not invent a second encoding.
- Transparent-rail escrow token: native XLM SAC, smallest units, I7 math. Confidential-rail underlying: the same XLM SAC (exact-transfer ✓); single milestone only (§3.3).
- Freshness `WINDOW = 600 s`, `GAP_MAX = 30 s`, `ALT_MAX = 1200 dm`, `VMAX` with DESIGN §5.5's 25% margin; dest-region default 3×3 RD cells; all in `constants.*`, three copies, parity-tested.
- `@ctd/sdk` from node uses the json-store state backend; sync openings within the RPC retention window and persist them in `out/` + the packet (§3.4).

## 7. Testing strategy (names are normative; from DESIGN §12 and §6.6)

1. **Parity** (P1): cross-language Poseidon on every domain-tagged structure. 2. **Circuit positive**: one honest witness per circuit vs fixture publics (fixtures via the transplanted `gen-fixtures.ts` pattern). 3. **Circuit negative**: one per DESIGN §12 row naming that circuit; assert *where* it fails (witness-gen vs constraint). 4. **Contract**: I1–I10 + listed T-row tests + the four hook tests (§3.4). 5. **E2E**: COURIER happy, DRONE happy, DRONE-without-flight revert, replay no-op, timeout refund, each `--attack` rejected; CT level's fund→settle→audit + refund + premature-settle-blocked. 6. **CI**: fmt/clippy, `circom --inspect` clean, suites above; localnet job for Aegis, testnet job (secrets-gated) for CT.

## 8. Agent guardrails — violate none, ever

1. Never accept a Merkle root, `C_S`, or head from a transaction argument where storage should supply it (I1).
2. Never add a Poseidon call without a `DOM_*` tag; never reuse a tag across structures.
3. Never compare/multiply field elements not strictly decomposed to their declared width in this circuit.
4. Never mark a circuit or hook done without its negative tests; never delete a negative test to green CI.
5. Never regenerate a zkey without redeploying the matching contract; never guess ptau size — measure the `.r1cs`.
6. Never write contract state after a token transfer in the same function (I8).
7. Never emit an event field that isn't already public by necessity (I10).
8. Never present simulated drone attestation as hardware security; the DESIGN §4 trust-anchor sentence appears wherever the drone is described.
9. Never spend past a cutline on a higher rung; bank the lower rung first.
10. Never merge the two proving stacks (§0); the confidential token is consumed as contracts + `@ctd/sdk`, its circuits/VKs untouched except registering the shipped VK set.
11. Never let escrow-key possession imply spending authority — the hook + registry state is the only authority; if a movement path exists that the hook does not cover, close it or drop to CT-B.
12. Never leave a confidential opening's only copy in RPC events (7-day retention); packet + `out/` persistence is mandatory.
13. When the spec is ambiguous, prefer the interpretation that reveals less on-chain and constrains more in-circuit; if that changes an interface, ⚠️ surface it.

## 9. Known gotchas (verified working knowledge — reuse, don't rediscover)

From v1: **node, not bun** for snarkjs proving workers; `circom … -l node_modules`; ptau rule `2·constraints ≤ 2^k` from the measured `.r1cs`; VK-baked-at-deploy coupling + committed-artifact repro note; `wasm32v1-none`; stellar-cli ≥27 deploy flow with constructor JSON args; `require_auth` before any state touch in privileged entrypoints; TTL extension on every persistent write; open-relayer caveat wording ("demo affordance, not a contract weakness"). From the CT demo: `stellar contract build` mandatory for `contracts-ct` (spec-shaking feature; plain cargo fails); keep it a **separate Cargo workspace** with its own lock (sdk 26.0.0 line) exactly as the demo does; pnpm workspace + `pnpm build:sdk` before anything imports `@ctd/sdk`; bb.js is vendored by script — don't "upgrade" it; recipients must `register` before they can be paid (carrier payout account registers at accept); `deposit` amounts are public by design; browser proving needs cross-origin isolation (irrelevant to the node CLI path).

## 10. Demo video shot list (target 2:40)

0:00 problem in one sentence over the badge wall → 0:15 create+fund; explorer: "the chain sees only this commitment — and on the confidential rail, **not even the amount**" → 0:40 carrier accepts; timeline advances, fields redacted; carrier's CLI verifies the hidden escrow balance against the on-chain commitment → 0:55 dronesim honest flight; split screen public-corridor vs carrier-only true route, watermarked → 1:20 `submit_flight` verifies on-chain → 1:35 recipient taps claim link, signs; `deliver` verifies; settlement lands with **no amount on the explorer** → 1:50 auditor console decrypts the amount: "private to the world, transparent to the regulator" → 2:05 `--attack stray` rejected, badge red; premature-settle blocked by the hook → 2:25 limitations: "the proof trusts the drone's key, not physics; the confidential rail is an unaudited preview — here's the roadmap" → 2:40 repo + contract ID card.

## 11. Definition of done

R-rung banked per §1 (CT level explicit in the README); all §7 suites green; testnet deployment with explorer-verifiable happy path AND one rejected-attack tx (AND one hook-rejected settle if CT-A/B); README quickstart reproducible from a fresh clone; video uploaded; BUIDL updated and self-reviewed; the v1 donor repo linked in the README provenance note; Honest Limitations present, specific, and inclusive of the §3 items.

## 12. Post-hackathon backlog (do not touch before submission)

A4 handoff; A5 conditions; A3 if unshipped; MPC ceremony; CT hardening: spender-delegation escrow refinement (`SpenderDelegation` exists in the OZ module, unexercised by the demo), multi-milestone confidential escrow via per-milestone sub-accounts, immutable/multisig verifier VKs, OZ `compliance` module evaluation; attempted-delivery griefing proofs; issuer/authority multisig + arbiter view-keys; BLS12-381 migration; OSNMA/secure-element integration; upstream PRs (`poseidon-merkle`, geocell toolkit — and an `AegisEscrowHooks` example to OZ's confidential module); SCF Build Award application.
