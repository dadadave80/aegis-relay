# Aegis Relay Marketplace — design spec

- **Date:** 2026-07-03
- **Status:** approved design → ready for implementation plan
- **Scope:** Spec 1 of a decomposed effort (see §12). Turns the single-player demo
  into a **believable multi-sided marketplace demo** on the existing testnet
  contracts and ZK core.

## 1. Problem

Today's console is **single-player**: one wallet toggles through all four roles,
the carrier is handed a shipment id out-of-band, and the recipient is a key the
server mints and self-signs (`prover-dist/merchant.js:33` generates the claim
seed; `recipient.js:73` signs the PoD with that same server-held seed). Nothing
is a marketplace: carriers can't *discover* jobs, there are no distinct
participants, and the mailbox is an in-memory `Map` + local JSON files that
survives neither Vercel's stateless functions nor cross-device shareable links.

We want the demo to *feel like* a live marketplace — real distinct
merchant/carrier/recipient participants, an open-shipments board carriers browse
and claim, and a real recipient claim link — while keeping the same
privacy/ZK/settlement core and staying Vercel-deployable + judge-testable.

## 2. Goals / non-goals

**Goals**
- A solo judge can drive the whole loop end-to-end via shareable links.
- Carriers **discover** open shipments on a board and claim them (gig model,
  first-come), gated by a carrier **credential**.
- The recipient is a **real, separate party** established by an app-minted
  **claim link**, signing the PoD **in the browser** (the honest fix).
- A **shared store** (KV) replaces the in-memory mailbox so state survives Vercel
  + shareable links.
- Light-touch **reputation**, carrier **onboarding**, and **notifications**;
  a **thin** disputes surface (existing refund-on-expiry).

**Non-goals (this spec)**
- No contract changes. Reuse the deployed registry / credentials / airspace / CT
  contracts and the existing Groth16 circuits.
- No price negotiation/bidding (escrow-at-create is the fare).
- No relational DB, email/notification infra, or deep arbitration (follow-on).

## 3. Decisions (from brainstorming)

| # | Decision |
|---|----------|
| Ambition | Believable multi-sided demo (testnet, no heavy backend) |
| Participants | Shareable role links + pre-seeded demo counterparties |
| Matching | **Gig board, first-come accept** (fixed escrow = fare) |
| Packet privacy | **Credential-gated** — only credentialed carriers pull the packet |
| Recipient | **App-minted claim link**, recipient signs the PoD **in-browser** |
| Features in | reputation, onboarding, notifications, **thin** disputes |
| Architecture | **A — KV-backed, extend the console** |

## 4. Architecture

Extend the existing Next.js dashboard. The only structural change is the store
backing; everything else is new surfaces + flows composed from existing pieces
(the two-step wallet-signed tx engine, browser Groth16 proving, the packet
crypto in `prover-dist/`).

```
Merchant (wallet A) ──create──► registry (OPEN)         ┌─ /market board (KV listings)
        │                          │                     │   carriers browse
        └─ recipient claim link ───┼─────────────────────┼─ Carrier (wallet B, credentialed)
                                   │                     │   claim → pull packet → verify T12
Recipient (claim link, no wallet) │                     │   → accept (first-come) → deliver
   opens link, signs PoD in-browser│                     └─ reputation / onboarding / notifs
                                   ▼
                              KV shared store  (ship / listing / openListings / claim / carrier / rep)
```

## 5. Shared store (KV)

`dashboard/lib/server/store.ts` keeps its **interface** (`getShip`, `putShip`,
`updateShip`, `getPending`, `putPending`, `delPending`, `listShipIds`); the
backing swaps from in-memory `Map` + `.demo-state/*.json` to a serverless KV
(Vercel KV / Upstash Redis via `@vercel/kv` or `ioredis`). A **memory adapter**
keeps `bun run dev` working with no KV configured (and preserves current local
behavior). All values are JSON.

Namespaces:

| Key | Value | Written by |
|-----|-------|------------|
| `ship:<id>` | mailbox `ShipRecord` (packet, proofs, escrow record) — as today | create/accept/deliver flows |
| `listing:<id>` | board summary: `{ amount, method, laneId, escrowDeadline, state, createdAt, payout? }` | create; state-synced on each read |
| `openListings` | sorted set of `OPEN` shipment ids (score = createdAt) | create adds; accept/expire removes |
| `claim:<token>` | recipient **signing context** (dest-region tree, carrier commit, shipment id, ts window) — **not** the seed | create |
| `carrier:<address>` | `{ credentialed: bool, onboardedAt }` | onboarding flow |
| `rep:<address>` | `{ delivered, expired }` counters | terminal-state sync |

**Claim-link secret handling (honesty):** the recipient's Baby Jubjub **claim
seed** is put in the claim-link **URL fragment** (`/claim/<id>#<seed>`), which is
never sent to the server. The server stores only the *signing context* under
`claim:<token>` and never retains the seed — so at delivery the server holds no
claim key. (Fallback if fragment UX proves awkward: store the seed under the
token and document the reduced-honesty tradeoff — but fragment is the target.)

## 6. The marketplace loop (data flow)

1. **Create (Merchant, wallet A)** — `buildCreate` as today, plus: mint the
   recipient claim seed, commit its pubkey in `C_S` (already done in
   `merchant.js`), write `listing:<id>` + add to `openListings`, and return the
   **recipient claim link** (`/claim/<id>#<seed>`) to the merchant UI. The seed is
   not persisted server-side.
2. **Discover (Carrier)** — `/market` reads `openListings` → `listing:<id>` for
   each; filter by lane/amount/deadline/rep. Source of truth is still on-chain
   (each row links to the registry); the KV index just makes the board fast.
3. **Claim (Carrier, credential-gated)** — `POST /api/market` `{shipmentId}`:
   the server checks `carrier:<address>.credentialed`; if ok, returns the sealed
   packet for that carrier to verify. Non-credentialed → rejected with an
   onboarding prompt.
4. **Verify + Accept (Carrier)** — carrier verifies T12 locally (existing
   `verifyFlow`), then the existing two-step accept (`buildAccept` → wallet signs
   → submit). **First valid accept wins** — the registry's WrongRole/state gates
   enforce it; a losing carrier gets "already accepted." On accept, remove from
   `openListings`, set `listing.state = IN_TRANSIT`, record `payout`.
5. **Drone (optional)** — fly + submit-flight, already **browser-proved** (this
   session's work).
6. **Recipient signs (claim link)** — the recipient opens `/claim/<id>#<seed>`,
   the page fetches the signing context (`claim:<token>` / by id), reads the seed
   from the fragment, derives the Baby Jubjub key and signs
   `m = Poseidon(DOM_PODMSG, shipment_id, carrier_pk_commit, cell_rd, ts)` **in
   the browser** (circomlibjs), and POSTs only the **signature** to the server,
   which stores it as the PoD in `ship:<id>`.
7. **Prove delivery + deliver (Carrier)** — existing browser Groth16 delivery
   proof (this session's work) using the stored PoD, then deliver → settle.
8. **Terminal sync** — on DELIVERED/EXPIRED, update `rep:<address>` and
   `listing.state`; remove from `openListings` if still present.

## 7. New surfaces

- **`/market`** — carrier board: list + filter (lane / amount / deadline / rep),
  `Claim` button per row (credential-gated; shows "Become a carrier" if not).
  Client-polls `openListings` for live add/remove + a toast on new matches.
- **`/claim/[id]`** — recipient page (no wallet): shipment context + a
  location-confirm + **Sign proof of delivery** (in-browser EdDSA-Poseidon).
  Reads the seed from the URL fragment.
- **Console changes** — after create, the Merchant panel surfaces the
  **recipient claim link** (copyable) + listing status; the Carrier panel's raw
  "accept an id" is replaced by **Claim from market** (deep-links to `/market`);
  a **Become a carrier** action (onboarding).
- **APIs** (all return the existing `{ok,error,data}` envelope):
  - `POST /api/market` — `{shipmentId}` → sealed packet (credential-gated claim);
    also a `GET`/list for the board.
  - `POST /api/claim` — `{shipmentId, signature, lat, lon}` → store PoD.
  - `GET /api/claim/<id>` — recipient signing context.
  - `POST /api/carrier/onboard` — issue a credential leaf.
  - `GET /api/carrier/<address>` — carrier status: `{ credentialed, reputation }`.

## 8. The four features (light)

- **Reputation** — `rep:<address>` counters derived from on-chain terminal states
  (delivered vs. refund-expired), shown on the board + a carrier chip. No new
  contract; recomputed/synced on shipment terminal transitions.
- **Onboarding** — "Become a carrier" issues a **credential leaf** via the
  deployed credentials contract, sets `carrier:<address>.credentialed`, unlocking
  claims. (Pre-seed one demo carrier so the loop works out of the box.)
- **Notifications** — the board **client-polls** `openListings` (interval); a
  toast when a new matching listing appears. SSE is a follow-on.
- **Disputes (thin)** — a first-class **"Refund (deadline passed)"** action
  wrapping the existing `refund_expired`, plus a "report" flag on `ship:<id>`.
  Deep arbitration → follow-on spec.

## 9. Privacy / trust boundaries

- The board exposes **only on-chain-public** metadata (escrow amount on the
  transparent rail — hidden on confidential; method; lane; deadline; state).
- The **sealed packet** (contents / recipient / address) is released **only to
  credentialed carriers on claim**. Non-credentialed carriers never receive it.
- The **claim link** is a bearer capability (unguessable; seed in the fragment);
  holding it *is* being the recipient — this matches the protocol's claim-key
  model. The server never holds/uses the seed at delivery.
- **First-come race:** two carriers may both pull the packet, but only the first
  `accept` binds on-chain; the loser gets a clean "already accepted." No funds at
  risk (payout is fixed at accept; §DESIGN I3).

## 10. Error handling

- All flows use the existing never-throw `{ok,error}` envelope.
- KV unavailable → the board falls back to on-chain reads; mailbox writes surface
  an inline error, never a crash.
- Credential-gate rejection → structured "not credentialed" with an onboarding
  CTA (not a bare error).
- Claim link opened for a non-existent/settled shipment → a clear terminal state
  message.

## 11. Testing / verification

- No dashboard test runner. Gates: `tsc` / `lint` / `bun run build` = 0.
- A scripted local lifecycle exercising the KV store (create → list → claim →
  record PoD) + the in-browser proof.
- **End-to-end (real credentialed accept → deliver → settle on testnet) requires
  a funded Freighter wallet** — the one thing not verifiable headless; run once
  after deploy.

## 12. Decomposition / sequencing

- **Spec 1 (this):** KV store swap · `/market` board · credential-gated claim ·
  real recipient claim link + in-browser PoD · reputation · onboarding ·
  notifications (poll) · thin disputes.
- **Follow-on specs:** deep arbitration; richer reputation; multi-region search;
  SSE notifications; email/contact claim delivery.

## 13. Risks / open items

- **Recipient signing context** needs the dest-region tree + carrier commit,
  which are packet-private — the recipient must receive their packet portion (or
  a signing-context subset) from the server by token. Confirm the minimal
  disclosure needed to compute `cell_rd` without leaking the full opening.
- **circomlibjs in the browser** for EdDSA-Poseidon PoD signing — already a
  dashboard dep and used server-side; verify it bundles + signs client-side (a
  small spike, like the snarkjs/bb.js spikes).
- **KV provider** — Vercel KV vs. Upstash Redis; pick per the deploy target;
  keep the adapter thin so it's swappable + memory-fallback for local.
- **Credential issuance** on the credentials contract needs an admin/authorized
  signer — confirm the demo can issue a leaf (or pre-seed) without a protocol
  change.

## 14. File touch map (for the plan)

- `dashboard/lib/server/store.ts` — KV backing behind the same interface (+ memory adapter).
- `dashboard/lib/server/flows.ts` — create writes listing + returns claim link; accept syncs listing/openListings; PoD-store flow.
- `dashboard/lib/server/prover-dist/merchant.js` / `recipient.js` — surface the claim seed to the link; move PoD signing client-side.
- New: `dashboard/app/market/page.tsx`, `dashboard/app/claim/[id]/page.tsx`, `dashboard/app/api/market/route.ts`, `dashboard/app/api/claim/route.ts`, `dashboard/app/api/carrier/onboard/route.ts`, `dashboard/lib/pod/sign-browser.ts` (client EdDSA-Poseidon).
- `dashboard/components/console/RolePanels.tsx` — merchant claim-link surface; carrier "Claim from market"; onboarding.
- `dashboard/lib/api.ts` / `dashboard/lib/types.ts` — new shapes.
