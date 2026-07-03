# Vendored: `@ctd/sdk`

This directory is a **vendored copy** of the client SDK from the upstream
confidential-token demo — copied in so this repo is self-contained (no reliance
on a sibling `../ct-demo` checkout).

- **Source:** https://github.com/brozorec/stellar-confidential-token-demo
  (package `packages/sdk`)
- **Vendored at commit:** `8b34def`
- **License:** MIT (see `LICENSE`) — upstream declares MIT in its root
  `package.json` and README.

## What's here

Only the **publishable** package is vendored — the prebuilt output, not the
TypeScript sources or tests:

- `dist/` — compiled JS + `.d.ts` type declarations (the SDK's `main`/`types`).
- `circuits/` — Noir circuit artifacts + verification keys imported at runtime
  (`register.json`, `transfer.json`, `withdraw.json`, `vks/`).
- `package.json` — trimmed to the runtime `dependencies` + `exports`; the build
  scripts and devDependencies were dropped (this is a prebuilt drop, not a
  buildable source tree).

## Consumers

This repo is a **bun workspace** (root `package.json` `workspaces` +
`bunfig.toml` `linker = "hoisted"`), so this package is a workspace member and
the consumers reference it via the workspace protocol — exactly how the upstream
monorepo wires it (`packages/app` uses `"@ctd/sdk": "workspace:*"`):

- `dashboard/package.json` → `"@ctd/sdk": "workspace:*"`
- `prover/package.json` → `"@ctd/sdk": "workspace:*"`

`bun install` (run at the repo root, or from any member) hoists every
dependency into the root `node_modules`, so the vendored SDK's own deps
(`@aztec/bb.js`, `@stellar/stellar-sdk`, `@noble/*`, `@noir-lang/noir_js`,
`@zkpassport/poseidon2`) resolve from the workspace root for both bun and node —
no per-consumer resolver flags. `circuits/` is intentionally NOT a workspace
member (it is circom tooling, not a JS package).

## Refreshing

To pull a newer upstream build:

```sh
# in the upstream checkout
cd /path/to/stellar-confidential-token-demo/packages/sdk
npm run build            # regenerate dist/

# back in this repo
cp -R <upstream>/packages/sdk/dist    vendor/ctd-sdk/
cp -R <upstream>/packages/sdk/circuits vendor/ctd-sdk/
# then update the "Vendored at commit" line above, and re-run `bun install` at the
# repo root so the workspace picks up any dependency changes.
```
