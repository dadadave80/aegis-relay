# Deployment & self-containment

## Self-containment status ✅

The repo needs **no external checkout** — everything the app imports lives in the
repo:

- `@ctd/sdk` is **vendored** at `vendor/ctd-sdk/` (was a `file:../../ct-demo`
  link into a sibling checkout). The JS side is a **bun workspace** (root
  `package.json` + `bunfig.toml`), and `@ctd/sdk` is consumed as `workspace:*`.
- The `/map` flight fixtures are vendored into `dashboard/lib/fixtures-data/`
  (were `../../circuits/fixtures`). The dashboard build no longer reaches outside
  `dashboard/` except for the in-repo workspace member `vendor/ctd-sdk`.
- No functional reference to `../ct-demo`, `/Users/...`, or any path outside the
  repo remains (only provenance comments — "ported from ct-demo").

**Local run:** `bun install` at the repo root, then `cd dashboard && bun run dev`
(or `build`). One hoisted `node_modules`; no per-package installs.

## Vercel

- **Root Directory:** `dashboard`. Framework preset: Next.js. Vercel detects
  `bun.lock` and installs the workspace with bun from the repo root.
- `next.config.ts` sets `outputFileTracingRoot` to the repo root so serverless
  function file-tracing includes the workspace-hoisted deps + vendored SDK.
- The confidential rail proves **in the browser** (bb.js) and needs the
  cross-origin-isolation headers already in `next.config.ts` (COOP/COEP) — these
  apply on Vercel automatically via `headers()`.
- Env vars to set in the Vercel project: `STELLAR_TESTNET_RPC_URL` (or
  `AEGIS_RPC_URL`) for a reliable Soroban RPC; optionally `NEXT_PUBLIC_CT_*`
  overrides (defaults are the deployed testnet ids).
- Graceful degradation: the auditor key (`prover/out/auditor-key.json`, a
  gitignored demo secret) is absent on Vercel, so `/api/confidential/audit`
  returns its honest "regulator decrypt unavailable" fallback rather than failing.

## Groth16 proving — browser-side (RESOLVED)

The two proving beats run **in the browser**, so the multi-MB zkeys never live in
a serverless function:

- **Static artifacts:** `dashboard/public/circuits/{delivery,flight}.wasm` +
  `{delivery,flight}_final.zkey` (~65 MB, committed, served from `/circuits`).
- **Two-phase flow:** `/api/drone/fly` and `/api/prove-delivery` each dispatch on
  the body — `{ shipmentId }` returns the assembled circuit *input* (server does
  the witness assembly, which needs the packet + crypto); the browser fetches the
  wasm/zkey and runs `snarkjs.groth16.fullProve` (`lib/proving/groth16-browser.ts`);
  `{ shipmentId, proof, publicSignals }` records the proof for the tx build.
- **Correctness:** the browser proves the *same* witness the server would have,
  and snarkjs is deterministic, so the proof is identical and flows through the
  unchanged proof→scVal tx-encoding — the on-chain verify path is preserved. (A
  browser spike confirmed snarkjs proves + verifies the delivery circuit
  client-side in ~0.8 s.) The flight zkey is 46 MB, so the first drone proof
  downloads it once (cached thereafter).

Nothing server-side proves anymore; `snarkjs` is a client-only dependency now.

**End-to-end verification note:** the full lifecycle (create → accept → fly →
submit-flight → prove-delivery → deliver, with the on-chain verify) needs a
funded Freighter wallet on testnet — verify it once after deploying. Everything
up to and including the browser proof is build-verified.
