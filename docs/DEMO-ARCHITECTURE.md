# Interactive demo architecture — pinned contract

The dashboard becomes a **click-driven demo console**: every CLI script in
`docs/demo-script.md` becomes a button. Judges (or the founder screen-sharing)
log in, switch roles, and drive the full lifecycle from the browser.

## Decisions (do not relitigate)

- **Privy = login/identity only** (`@privy-io/react-auth` v3, installed). It gives
  the "good UX" entry gate (email/social login). It does **not** sign Stellar txs.
  If `NEXT_PUBLIC_PRIVY_APP_ID` is unset, the app runs in **guest mode** (a
  "Enter demo" button that mints a local session id) so it works with zero config.
- **All Stellar txs + all proving happen server-side** in Next API routes
  (node runtime). Per-session role keypairs live in a server vault, auto-funded
  via friendbot. This is the "open relayer demo affordance" already documented as
  an honest limitation — it makes the demo bulletproof (no extension, no wallet
  popups mid-demo). Recipient PoD signing is server-side too (the packet's Baby
  Jubjub key), framed in the UI as "the recipient's device signs."
- **Role switching** is a UI control — the founder flips Merchant → Carrier →
  Recipient → Auditor → Attacker freely. One session, all roles.
- Contracts = the **final deployment** (see `docs/testnet.md`; already in
  `dashboard/lib/contract.ts`). Registry shipment ids are global/sequential.
- Reuse, don't rewrite: server code imports the pure helpers from
  `../prover/src/lib/{poseidon,constants,bn254,tree,packet}.ts` and the flow
  logic patterns from `../prover/src/{carrier,recipient,dronesim}.ts` +
  `../prover/src/lib/flight.ts`. Turbopack root is the repo, so these resolve.
- Proving artifacts on the server: `../circuits/build/{delivery_final.zkey,
  delivery_js/delivery.wasm,flight_final.zkey,flight_js/flight.wasm}` (present
  locally; gitignored). VKs: `../circuits/fixtures/{delivery,flight}/verification_key.json`.
  Path via env `AEGIS_ARTIFACTS_DIR` (default `../circuits/build`).
- RPC: env `AEGIS_RPC_URL` (default the public testnet RPC; set to
  `http://127.0.0.1:8971` in local dev to use the sandbox proxy). Passphrase
  "Test SDF Network ; September 2015".

## Shared contract

`dashboard/lib/types.ts` (types) and `dashboard/lib/api.ts` (client wrappers)
are the pinned interface. Server routes MUST match those shapes exactly.

## API routes (server owns app/api/**, lib/server/**)

| Route | Body → | Does |
|---|---|---|
| `POST /api/session` | `{sessionId}` | vault.getOrCreate: gen merchant+carrier keypairs, friendbot-fund (idempotent, parallel), return `SessionInfo` |
| `GET /api/session?sessionId=` | — | current addresses + live balances |
| `POST /api/merchant/create` | `CreateReq` | build C_S + packet (reuse merchant flow), submit `create_shipment` signed by session merchant, store packet server-side keyed by shipmentId, return `CreateRes` |
| `POST /api/carrier/verify` | `ShipmentReq` | recompute C_S from stored packet vs on-chain `status` → `VerifyRes` (T12) |
| `POST /api/carrier/accept` | `ShipmentReq` | session carrier signs `accept` (payout=carrier), store carrier pk-commit/blind server-side, return updated `ShipmentView` |
| `POST /api/drone/fly` | `ShipmentReq` | dronesim honest flight + snarkjs flight prove; store proof; return `FlyRes` (waypoints for the map) |
| `POST /api/drone/submit` | `ShipmentReq` | submit_flight; return `ShipmentView` (flightOk) |
| `POST /api/recipient/sign-pod` | `SignPodReq` | derive BJJ key from stored packet claim seed, sign PoD, store pod |
| `POST /api/carrier/prove-deliver` | `ShipmentReq` | assemble delivery witness (packet+pod), snarkjs prove; store proof |
| `POST /api/carrier/deliver` | `ShipmentReq` | submit `deliver`; return `ShipmentView` (DELIVERED, escrow released) |
| `POST /api/confidential/audit` | `ShipmentReq` | auditor decrypt of the last confidential settlement → `AuditRes` |
| `POST /api/attack` | `AttackReq` | run the chosen attack, capture the on-chain/witness rejection → `AttackRes` |
| `GET /api/shipment/[id]` | — | on-chain `status` → `ShipmentView` |

**Confidential rail:** create/accept/deliver share the transparent routes with
`rail:"confidential"`. Escrow funding + hook-caged settle + auditor decrypt reuse
`../prover/src/confidential.ts` logic server-side. If wiring `@ctd/sdk` into the
Next bundle proves too heavy in the time budget, the confidential CREATE may fall
back to displaying the already-live confidential shipment (docs/testnet.md, tx
`2d990d64…`) with a real auditor-decrypt call — the "hidden amount → regulator
decrypts" beat must land either way. Document whichever path shipped.

**Tx submission:** use `@stellar/stellar-sdk` (v16, already a dep) with in-memory
`Keypair`s — build the contract invoke, `rpc.Server.prepareTransaction`, sign,
send, poll. Enum args (Method/Rail) are **u32** (`nativeToScVal(n, {type:'u32'})`);
U256 via `nativeToScVal` with the ScVal U256 form or the pattern in
`prover/src/lib/bn254.ts`; Address/i128/vec per SDK. Capture contract error codes
verbatim for the attack beats (do NOT swallow them).

**Vault** (`lib/server/vault.ts`, server-only): `Map<sessionId, {merchant, carrier,
recipientSeedHex}>` cached to a gitignored file so dev restarts keep keys. Never
return secret seeds to the client. Friendbot: `GET https://friendbot.stellar.org?addr=`.

## Client (UI owns app/demo/**, components/**, app/providers.tsx, app/layout.tsx)

- `app/providers.tsx` — PrivyProvider (when app id set) + guest fallback + a
  React context exposing `{sessionId, session, role, setRole, refresh}`.
- `app/demo/page.tsx` — the console: top bar (login state, funded role balances,
  contract links), a **role switcher**, a **lifecycle board** (the current
  shipment's timeline + seen-vs-hidden panel + explorer links + corridor map),
  and the per-role action panel.
- Role panels: **Merchant** (create form: dest, amount, method, rail →
  Create), **Carrier** (pick shipment → Verify → Accept → for drone: Fly &
  Prove → Submit Flight → Prove Delivery → Deliver), **Recipient** (Sign
  proof-of-delivery), **Auditor** (Decrypt confidential amount), **Attacker**
  (buttons for each attack → shows the red rejection + error code).
- Reuse the existing dark/mint design system (`app/globals.css`, components
  `StatusBadge`, `Hash`, `MetricTile`, `ShipmentTimeline`, `Redacted`). Keep the
  informational pages (`/`, `/map`, `/verify`); make `/demo` the star and link it
  prominently from `/`.
- Every long action shows a spinner + step label; failures render inline (never
  crash the page). Poll `GET /api/shipment/[id]` after each mutation to refresh
  the board.
