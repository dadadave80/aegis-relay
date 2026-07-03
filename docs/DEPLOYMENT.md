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

## ⚠️ The one blocker — server-side Groth16 proving (DECISION PENDING)

`/api/drone/fly` (`flyFlow`) and `/api/prove-delivery` (`proveDeliveryFlow`) run
**live snarkjs Groth16 proving** — `groth16.fullProve(witness, wasm, zkey)` —
against `circuits/build/{delivery,flight}_final.zkey` + the matching wasm
(~**65 MB**, part of a 547 MB gitignored `circuits/build`). Delivery proving gates
**every** shipment's settle, so it's on the critical path. Fixture proofs can't
substitute (the proof's public inputs — `c_s`, `head` — are per-shipment). This
will not run on Vercel as-is: the artifacts aren't in the repo and don't fit a
serverless function.

Options (see the pinned question in the working session):

1. **Move proving to the browser (recommended).** Server assembles the circuit
   *inputs* and returns them; the browser fetches the wasm/zkey (static assets)
   and runs `snarkjs.groth16.fullProve` client-side — exactly how the confidential
   rail already proves in-browser. No serverless size/timeout limits; no 65 MB in
   a function. ~15-30 MB browser download per circuit (cached).
2. **Keep server-side, commit the 65 MB** (ideally Git LFS) + configure the
   proving functions (`outputFileTracingIncludes` for the wasm/zkey, max
   memory/`maxDuration`; needs Vercel Pro for the timeout). Minimal code change,
   but git bloat + a real serverless proving-time/cold-start risk.

Until this is chosen, a Vercel deploy serves everything except the two proving
routes: overview, `/track`, `/map`, the console (connect, transparent create,
verify, accept, recipient sign), and the confidential auditor beat all work.
