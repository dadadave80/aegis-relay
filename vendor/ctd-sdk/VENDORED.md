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

Referenced as a local `file:` dependency, so `bun install` / `npm install`
resolve the SDK's own dependencies from the trees below:

- `dashboard/package.json` → `"@ctd/sdk": "file:../vendor/ctd-sdk"`
- `prover/package.json` → `"@ctd/sdk": "file:../vendor/ctd-sdk"`

## Refreshing

To pull a newer upstream build:

```sh
# in the upstream checkout
cd /path/to/stellar-confidential-token-demo/packages/sdk
npm run build            # regenerate dist/

# back in this repo
cp -R <upstream>/packages/sdk/dist    vendor/ctd-sdk/
cp -R <upstream>/packages/sdk/circuits vendor/ctd-sdk/
# then update the "Vendored at commit" line above, and re-run the consumer installs
```
