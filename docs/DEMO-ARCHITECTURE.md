# Interactive app architecture — pinned contract (wallet-signing / non-custodial)

A real dApp, not a relayer console: **connect a Privy wallet → pick a role →
your wallet authorizes that role's on-chain actions.** No server-held Stellar
keys.

## Decisions (final — do not relitigate)

- **Privy embedded Stellar wallet signs every Stellar transaction.** Privy
  supports Stellar at Tier 2 (`@privy-io/react-auth/extended-chains`):
  `useCreateWallet({chainType:"stellar"})` provisions it, `useSignRawHash({address,
  chainType:"stellar", hash})` signs a 32-byte hash → `{signature}`. That is the
  only client-side crypto we need.
- **Soroban `require_auth` is satisfied by the transaction SOURCE-ACCOUNT
  signature.** So for `create_shipment(merchant,…)` we set the connected wallet
  as BOTH the `merchant` arg AND the tx source; the wallet's envelope signature
  authorizes it. Same for `accept` (carrier = connected wallet = source = payout).
  `submit_flight`/`deliver`/`refund_expired` are permissionless — the connected
  wallet is just the source (pays the fee) and signs the envelope. **No separate
  SorobanAuthorizationEntry signing is needed.**
- **Two-step tx flow (server builds, wallet signs, server submits — server holds
  NO keys):**
  1. `POST /api/tx/build` → server builds the invoke with the connected pubkey as
     source, `rpc.Server.prepareTransaction` (simulate + assemble), caches the
     prepared tx by `buildId`, returns `{buildId, hashHex}` (hashHex = `tx.hash()`).
  2. Client: `signRawHash({address, chainType:"stellar", hash:"0x"+hashHex})` → sig.
  3. `POST /api/tx/submit {buildId, signatureHex, pubkey}` → server loads the
     cached tx, attaches a `DecoratedSignature` (hint = last 4 bytes of the
     StrKey-decoded pubkey, signature = the 64 raw bytes), `sendTransaction`, polls
     `getTransaction`, returns `{tx, shipmentId?, view?}`. The server cannot forge
     — the signature is the wallet's.
- **All Poseidon / circom / proving / packet crypto runs SERVER-SIDE** (stateless,
  no custody): the server reuses `../prover/src/lib/*` + the flow logic. Proving
  isn't custody; the only custody op is the Stellar signature, which the wallet does.
- **Auto-faucet:** on connect, friendbot-fund the connected Stellar address
  (`POST /api/faucet {address}` proxies `https://friendbot.stellar.org?addr=`).
- **Role model:** one connected wallet = one Stellar identity; the role switcher
  selects which role's actions you perform. Playing all roles yourself → your one
  wallet is merchant+carrier (the registry allows it). Two people → two wallets;
  the packet mailbox lets a second wallet carry a shipment the first created.
- **Recipient** never signs a Stellar tx — the PoD is a Baby Jubjub (circuit)
  signature over the packet's claim key. `POST /api/recipient-pod` signs it
  server-side with the packet's claim seed (the "claim link" the merchant issued),
  stored in the mailbox. Framed in UI as "the recipient's device signs."
- Contracts = the final deployment (docs/testnet.md; already in
  `dashboard/lib/contract.ts`). RPC via `AEGIS_RPC_URL` (default public testnet;
  `http://127.0.0.1:8971` proxy in local sandbox). Passphrase
  "Test SDF Network ; September 2015".
- Proving artifacts: `../circuits/build/{delivery_final.zkey,delivery_js/
  delivery.wasm,flight_final.zkey,flight_js/flight.wasm}`; VKs under
  `../circuits/fixtures/*`. Path base env `AEGIS_ARTIFACTS_DIR` (default
  `<repo>/circuits/build`).

## Server (owns app/api/**, lib/server/**) — STATELESS, no Stellar keys

| Route | Body → | Does |
|---|---|---|
| `POST /api/tx/build` | `BuildTxReq` | build+prepare the named invoke with `source`=connected pubkey; for `create` also generate the shipment packet (C_S opening + recipient BJJ claim seed) and hold it pending; for `accept` generate the per-shipment carrier BJJ key + carrier_pk_commit. Cache prepared tx by `buildId`. → `BuildTxRes{buildId, hashHex, meta?}` |
| `POST /api/tx/submit` | `SubmitTxReq` | attach the wallet signature, submit, poll; on `create` capture the assigned `shipmentId` from the return value and persist the packet under it; → `SubmitTxRes{tx, shipmentId?, view?}` |
| `POST /api/drone/fly` | `ShipmentReq` | dronesim honest flight + snarkjs flight prove; store proof; → `FlyRes` (waypoints) |
| `POST /api/prove-delivery` | `ShipmentReq` | assemble delivery witness (packet + carrier BJJ + pod) + snarkjs prove; store proof |
| `POST /api/recipient-pod` | `SignPodReq` | sign PoD with the packet claim seed; store pod |
| `POST /api/confidential/audit` | `ShipmentReq` | auditor decrypt → `AuditRes` |
| `POST /api/attack` | `AttackReq` | run the chosen attack, capture the rejection verbatim → `AttackRes` |
| `POST /api/faucet` | `{address}` | friendbot-fund; → `{funded, balanceXlm}` |
| `GET /api/shipment/[id]` | — | on-chain `status` → `ShipmentView` |

`build` supports `action`: `create | accept | submitFlight | deliver | refund`.
For `submitFlight`/`deliver` the server injects the stored proof + nullifier + ts.
Store (mailbox) keyed by shipmentId in a gitignored dir + in-memory Map; holds
packet, carrier BJJ, pod, proofs. Never return BJJ/claim seeds to the client.
Reuse `@stellar/stellar-sdk` (dep) for build/sign-attach/submit; reuse
`../prover/src/lib/{poseidon,constants,bn254,tree,packet}.ts` + flow logic. Add
`serverExternalPackages:["snarkjs","circomlibjs"]` to next.config.ts (keep the
existing turbopack.root). `export const runtime="nodejs"` on every route.

## Client (owns app/providers.tsx, app/demo/**, components/demo/**, lib/wallet-flows.ts, lib/wallet-context.tsx, lib/api.ts, session-context)

- providers.tsx: `PrivyProvider` (appId from `NEXT_PUBLIC_PRIVY_APP_ID`; guest
  fallback if unset). Config: dark theme, mint accent, `loginMethods
  ["email","wallet","google"]`. On login ensure a Stellar wallet via
  `useCreateWallet({chainType:"stellar"})` if the user has none.
- wallet-context: expose `{stellarAddress, ready, funded, ensureFunded(), signHash(hex)}`
  where `signHash` wraps `useSignRawHash`. Guest mode: no wallet → gate actions with
  a "connect wallet" prompt (guest can still browse the board).
- `lib/wallet-flows.ts` — the orchestration hook `useWalletFlows()` exposing
  `create/accept/submitFlight/deliver/refund`, each = `api.buildTx(...)` →
  `signHash(hashHex)` → `api.submitTx(...)`, returning the `SubmitTxRes`. The role
  panels call THESE for on-chain actions and `api.*` for stateless ones
  (proveDelivery, fly, recipientPod, audit, attack, shipment).
- `lib/api.ts` — thin fetch wrappers for every server route (already the shape to
  match; update to the routes above).
- The existing console (components/demo/*: Console, RoleSwitcher, LifecycleBoard,
  SeenVsHidden, CorridorMini, RolePanels, DemoTimeline, LoginScreen, TopBar,
  primitives, toast) is committed and REUSED — rewire the RolePanels action
  handlers from the old relayer `api.create/accept/...` to `useWalletFlows()`, and
  replace the old "server role vault" session provisioning with wallet connect +
  auto-faucet. Keep the design, the board, the seen-vs-hidden money-shot, the
  attack cards, the drone honesty line.

## Honesty notes for the UI/README
- Proving + packet + PoD signing run on a server service (stateless, no fund
  custody); the wallet holds custody and authorizes all value movement. State this.
- deliver/submit_flight are permissionless by design (I3) — the connected wallet
  submits + pays; anyone could. Not a weakness.
