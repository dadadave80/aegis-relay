# Aegis Relay — dApp console

A real wallet-signed dApp: connect a Stellar wallet (Freighter · Albedo · xBull ·
Lobstr · Hana · Rabet via Stellar Wallets Kit), pick a role (Merchant · Carrier ·
Recipient · Auditor), and drive the full shipment lifecycle from the
browser. **Every action is a button; your connected wallet signs every on-chain
transaction** (non-custodial — the server holds no Stellar keys, it only builds
txs and hands your wallet the XDR to sign). Also serves the informational pages:
shipment tracking (`/track/[id]`), the lane-7 corridor privacy demo (`/map`), and
the recipient PoD explainer (`/verify`).

## Run it

```bash
cd dashboard
bun install
bun run dev            # http://localhost:3000  → open /console
```

### Required env (`dashboard/.env.local`)

```
STELLAR_TESTNET_RPC_URL=<a Soroban testnet RPC>  # e.g. Alchemy; falls back to public RPC
```

- **Install a Stellar wallet:** the app connects via Stellar Wallets Kit — have
  a testnet-enabled wallet extension ready (Freighter is the easiest). The
  "Connect wallet" button opens a picker; your wallet signs each transaction.
  No app-side auth keys needed.
- **Proving artifacts** must be present on the machine running the server:
  `circuits/build/{delivery_final.zkey,delivery_js/delivery.wasm,
  flight_final.zkey,flight_js/flight.wasm}` (gitignored; produced by
  `node circuits/build.mjs` + the dev ceremony — see the repo root README). The
  server proves delivery/flight with these; they never touch the browser.
- Informational-page overrides (optional, testnet defaults baked in):
  `NEXT_PUBLIC_REGISTRY_ID`, `NEXT_PUBLIC_AIRSPACE_ID`,
  `NEXT_PUBLIC_CREDENTIALS_ID`, `NEXT_PUBLIC_NATIVE_SAC`, `NEXT_PUBLIC_RPC_URL`.

## How it works

- **Connect → Stellar wallet:** Stellar Wallets Kit connects Freighter / Albedo /
  xBull / Lobstr / Hana / Rabet. On connect the address is auto-funded via
  friendbot.
- **On-chain actions (create, accept, submit_flight, deliver):** the server
  builds + simulates the Soroban invoke with your wallet as source and returns
  the prepared XDR; your wallet signs the full transaction (`signTransaction`);
  the server submits it. Soroban's source-account auth means your signature
  satisfies `require_auth` — no relayer, no custody.
- **Proving / Poseidon / packet / PoD:** run server-side (stateless, not
  custody). The recipient's proof-of-delivery is a Baby Jubjub circuit signature
  over the claim key — "the recipient's device signs".
- **Drone shipments** fly the regulator-approved lane 7 (its corridor root is
  published on-chain); the flight proof is verified on-chain before delivery.
- **Illegal actions are caught by the protocol's own guards** — a replayed or
  tampered proof fails on-chain verification, an off-corridor flight can't even
  generate a witness, and a premature confidential settle is blocked by the
  token hook. No dedicated adversary role is needed to show it.

Contracts: the final testnet deployment (see repo `docs/testnet.md`).
Architecture detail: `docs/DEMO-ARCHITECTURE.md`.
