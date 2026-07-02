# Aegis Relay dashboard

Next.js 16 demo UI for the Aegis Relay registry on Stellar testnet: shipment tracking (`/track/[id]`), the lane-7 corridor privacy demo (`/map`), and the recipient PoD explainer (`/verify`).

Run: `cd dashboard && bun install && bun run dev` (build: `bun run build`).

Env (all optional, testnet defaults baked in): `NEXT_PUBLIC_REGISTRY_ID`, `NEXT_PUBLIC_AIRSPACE_ID`, `NEXT_PUBLIC_CREDENTIALS_ID`, `NEXT_PUBLIC_NATIVE_SAC`, `NEXT_PUBLIC_RPC_URL`.
