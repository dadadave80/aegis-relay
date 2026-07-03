# Demo video script — Aegis Relay (target 2:45, hard cap 3:00)

Record at 1080p+. The spine is the **marketplace web app** (the product); two
crypto showpieces the UI doesn't surface — the confidential rail and the attack
rejections — are shot from the **CLI**. Every on-chain claim gets an explorer shot.

## Recording setup

- **Browser tabs pre-opened:** the app (`localhost:3000` or `aegis-relay.vercel.app`),
  a second tab/incognito window for the **recipient claim link**, and `stellar.expert/explorer/testnet`.
- **Terminal:** large font, dark theme, `cd prover` ready (for the CLI beats).
- **Wallets:** two funded testnet **Freighter** accounts — a wallet is bound to
  **one on-chain role**, so the merchant and the carrier must be *different*
  wallets (or use the pre-funded demo carrier). The recipient needs **no** wallet.
- **Rail:** drive the web-app flow on the **Transparent** rail (confidential
  *create* is CLI-only in this build — see beat 7). Funded wallets are needed for
  `accept` / `deliver` / settle.

---

## Shot list

**0:00–0:12 — Problem (app `/` hero).** VO: "Every shipment today leaks its
manifest — what's inside, what it's worth, who's receiving it, the exact route.
Aegis Relay settles deliveries on Stellar while the chain learns none of it."

**0:12–0:32 — Merchant lists a shipment (Console → Merchant).** Fill the create
form (Drone · Transparent), **Create shipment** → Freighter signs → cut to the
explorer create tx, then back to the panel showing the **copyable recipient
claim link** + the shipment on the Lifecycle board (OPEN). VO: "A merchant lists
a delivery. The chain stores one opaque Poseidon commitment — and the app hands
back a claim link for the recipient. Nothing else is on-chain."

**0:32–0:56 — Carrier discovers + claims (the marketplace beat).** Switch to the
second wallet, open **`/market`**. Browse the open-shipments board (filter by
lane/amount). **Become a carrier** (onboard) → **Claim** the job → the sealed
packet arrives → **Verify packet** (VERDICT: OK — recomputes `C_S`, matches
on-chain) → **Accept** → Freighter signs; board flips to IN TRANSIT. VO:
"Carriers don't get handed a job — they discover it on an open board. Only
credentialed carriers can pull the sealed packet, and they verify it against the
on-chain commitment before binding custody. First valid accept wins."

**0:56–1:18 — Drone flight, proved in the browser.** Carrier panel:
**Simulate flight & prove** (the *SIMULATED secure element* banner is visible).
The **Groth16 proof is generated in the browser** (snarkjs + the flight zkey) —
call it out. `/map`: public corridor grid + watermarked true route. **Submit
flight proof** → explorer tx; timeline → FLIGHT VERIFIED, `flight_ok false→true`.
VO: "Sixteen signed telemetry points become one Groth16 proof — generated right
here in the browser — proving the flight stayed inside the regulator's corridor,
no gaps, no teleports, under the caps, without publishing a single coordinate.
The contract verifies it with Stellar's native BN254 pairing."

**1:18–1:36 — Recipient confirms in their own browser (claim link).** Open the
**claim link** (`/claim/<id>`) in the second tab — **no wallet**. Confirm the
location, **Sign proof of delivery** (EdDSA-Poseidon in the browser). VO: "The
recipient opens their claim link and signs delivery in their own browser — the
seed rides in the URL fragment, the server never holds the key. The signature is
bound to this carrier, this region, this moment."

**1:36–1:52 — Deliver = verify-and-settle.** Back to Carrier: **Prove delivery**
(browser Groth16) → **Deliver** → Freighter signs → explorer: escrow → payout in
**one** tx; timeline → DELIVERED. VO: "Prove delivery, then verify-and-settle —
one atomic Soroban transaction. No oracle, no off-chain settlement layer."

**1:52–2:06 — The privacy payoff: Ledger Lens (press `L`).** Toggle Ledger Lens;
the FACT table collapses to the CHAIN column only. VO: "This is everything the
public chain ever learned: an opaque commitment, an escrow, a state machine, a
proof. Contents, recipient, and route — never on-chain."

**2:06–2:22 — Confidential rail + auditor (CLI beat).** Cut to terminal: the
confidential courier — the settle tx on the explorer shows **no amount**; the
auditor key decrypts **50 XLM**. VO: "An optional rail hides the escrow amount
too. The explorer shows a transfer with no number — only the regulator's key
opens it. Private to the world, transparent to the regulator."

**2:22–2:34 — The kicker: attacks fail (CLI beat).** `dronesim fly --attack
stray` → "REJECTED AT WITNESS GENERATION"; then the hook-blocked premature settle
(transfer from escrow before DELIVERED → contract panic on explorer). VO: "A
drone one cell off-corridor can't even produce a proof. And escrow keys grant
zero spending authority — the token's hooks ask the state machine first."

**2:34–2:45 — Honest limitations + close.** README *Honest Limitations* on screen
(land on #1 physics-not-key, #4 unaudited preview, #10 the demo layer). VO: "The
proof trusts the drone's key, not physics. The confidential rail is an unaudited
preview. The marketplace's off-chain conveniences are a demo layer, not the trust
boundary — it's all in the README, next to everything that already works on
testnet today." End card: **aegis-relay.vercel.app** + registry
`CAROLAUWCN…6ZKPZL`.

---

## Marketplace flow — click crib (web app)

1. **Merchant** (wallet A): Console → *Merchant* → set destination/amount, Method
   *Drone*, Rail *Transparent* → **Create shipment** (sign) → copy the **claim link**.
2. **Carrier** (wallet B): `/market` → **Become a carrier** → **Claim** the id →
   **Verify packet** → **Accept** (sign). *(Board deep-links back as
   `/console?claimed=<id>`.)*
3. **Carrier**: **Simulate flight & prove** (browser proof) → **Submit flight proof** (sign).
4. **Recipient** (claim link, no wallet): `/claim/<id>` → **Sign proof of delivery**.
5. **Carrier**: **Prove delivery** (browser proof) → **Deliver** (sign) → settled.
6. Press **`L`** for Ledger Lens; `/track/<id>` is the public tracker (Lens always on).

## CLI crib — confidential rail + attacks (beats 7–8)

```bash
export AEGIS_REGISTRY_ID=CAROLAUWCNZGSLSAISY5OVY5GZDZ6ULPBAO3U4FKTU3OIAOVPO6ZKPZL
export AEGIS_AIRSPACE_ID=CCOEGSF3BSLXYKZMMX2OCSOJONAGORRWSI33TIUX3EHPVVHNMVHNENOY
export AEGIS_NETWORK=testnet
cd prover

# Confidential rail (amount hidden + auditor decrypt) — full driver:
#   src/confidential.ts ; step-by-step log: prover/test-e2e/confidential-e2e.md

# Attack beats:
node --import tsx/esm src/dronesim.ts fly --id N --attack stray \
  --from 6.4900,3.3500 --to 6.5244,3.3792 --lane 7   # → REJECTED AT WITNESS GENERATION
#   premature-settle hook rejection: prover/test-e2e/confidential-e2e.md (Error #4302)
```

> Prefer an all-terminal cut? The prior CLI-only lifecycle script is in the git
> history of this file (before the marketplace rewrite) and still runs against
> the deployed registry — the full `merchant → carrier → dronesim → recipient →
> deliver` crib lives in the README's *Drive the live testnet deployment* section.
