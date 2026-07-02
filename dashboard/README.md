# Aegis Relay — dApp console

A real wallet-signed dApp: connect a Privy wallet, pick a role
(Merchant · Carrier · Recipient · Auditor · Attacker), and drive the full
shipment lifecycle from the browser. **Every action is a button; your connected
wallet signs every on-chain transaction** (non-custodial — the server holds no
Stellar keys, it only builds txs and hands your wallet the hash to sign). Also
serves the informational pages: shipment tracking (`/track/[id]`), the lane-7
corridor privacy demo (`/map`), and the recipient PoD explainer (`/verify`).

## Run it

```bash
cd dashboard
bun install
bun run dev            # http://localhost:3000  → open /demo
```

### Required env (`dashboard/.env.local`)

```
NEXT_PUBLIC_PRIVY_APP_ID=<your Privy app id>     # dashboard.privy.io
PRIVY_APP_SECRET=<your Privy app secret>
STELLAR_TESTNET_RPC_URL=<a Soroban testnet RPC>  # e.g. Alchemy; falls back to public RPC
```

- **Privy allowed origins:** in the Privy dashboard, add your demo origin
  (`http://localhost:3000`) to the app's allowed domains, or login will fail.
- Without `NEXT_PUBLIC_PRIVY_APP_ID` the app runs in **guest mode** (browse
  read-only; on-chain actions need a wallet).
- **Proving artifacts** must be present on the machine running the server:
  `circuits/build/{delivery_final.zkey,delivery_js/delivery.wasm,
  flight_final.zkey,flight_js/flight.wasm}` (gitignored; produced by
  `node circuits/build.mjs` + the dev ceremony — see the repo root README). The
  server proves delivery/flight with these; they never touch the browser.
- Informational-page overrides (optional, testnet defaults baked in):
  `NEXT_PUBLIC_REGISTRY_ID`, `NEXT_PUBLIC_AIRSPACE_ID`,
  `NEXT_PUBLIC_CREDENTIALS_ID`, `NEXT_PUBLIC_NATIVE_SAC`, `NEXT_PUBLIC_RPC_URL`.

## How it works

- **Login → Stellar wallet:** Privy provisions an embedded Stellar wallet
  (`extended-chains`). On connect the wallet is auto-funded via friendbot.
- **On-chain actions (create, accept, submit_flight, deliver):** the server
  builds + simulates the Soroban invoke with your wallet as source and returns
  the tx hash; your wallet signs it (`signRawHash`); the server attaches the
  signature and submits. Soroban's source-account auth means your signature
  satisfies `require_auth` — no relayer, no custody.
- **Proving / Poseidon / packet / PoD:** run server-side (stateless, not
  custody). The recipient's proof-of-delivery is a Baby Jubjub circuit signature
  over the claim key — "the recipient's device signs".
- **Drone shipments** fly the regulator-approved lane 7 (its corridor root is
  published on-chain); the flight proof is verified on-chain before delivery.
- **Attacker role** shows the failure classes live: replayed proof, tampered
  proof, wrong proof, off-corridor flight (can't even generate a witness), and a
  premature confidential settle blocked by the token hook.

Contracts: the final testnet deployment (see repo `docs/testnet.md`).
Architecture detail: `docs/DEMO-ARCHITECTURE.md`.
