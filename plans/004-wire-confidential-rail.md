# Plan 004: Wire the confidential-escrow rail into the app

> **Executor instructions**: Follow this plan phase by phase. Run every
> verification command and confirm the expected result before moving on. This is
> a LARGE plan with a hard prerequisite (Phase 0 redeploys a contract) and real
> integration unknowns — honor every STOP condition; do not improvise around a
> blocked SDK integration. When done, update the status row in `plans/README.md`
> (unless a reviewer told you they maintain it).
>
> **Drift check (run first)**:
> `git diff --stat 1861ec6..HEAD -- dashboard/ prover/src/confidential.ts contracts-ct/`
> If those changed since this plan was written, compare the "Current state"
> excerpts against live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P3 (feature; the transparent + drone lifecycles already work, and
  the confidential compliance beat is showcasable via the Auditor role even before this)
- **Effort**: L
- **Risk**: HIGH (adds a second proving stack + a cross-major-version SDK to the
  dashboard; redeploys a contract; introduces a server-held confidential identity)
- **Depends on**: 001 (deployed), 002, 003 all DONE (they are)
- **Category**: feature
- **Planned at**: commit `1861ec6`, 2026-07-03

## Why this matters

The Merchant create form offers a **Confidential** escrow rail (🔒), but selecting
it fails with *"confidential-rail create is not wired into the wallet flow this
pass"* — the server throws (`dashboard/lib/server/flows.ts:183-190`). This plan
makes confidential create actually work: a shipment whose **escrow amount is
hidden on-chain** (a Pedersen commitment on the hooked OpenZeppelin confidential
token), settled to the carrier after delivery, with the regulator able to decrypt
the amount. It's the headline privacy feature (`DESIGN.md §6.6`) and the only
part of the pitch not live in the app.

## The design (client-side, wallet-driven — mirrors the upstream demo)

The upstream `brozorec/stellar-confidential-token-demo` **web app** (cloned at
`/Users/dadadave/Dev/Stellar/ct-demo/packages/app`) proves the confidential rail
runs fully client-side with a browser wallet, and ships the exact helpers to port.
Two facts (verified in that source) drive the design:

1. **The Grumpkin confidential key is DERIVED deterministically from a wallet
   *message* signature — never stored, never server-held.**
   `packages/app/lib/derive-key.ts`: `sk = SHA-512(wallet.signMessage(msg)) mod r`,
   where `msg = keyDerivationMessage(networkPassphrase, tokenContract)`. Ed25519
   signatures are deterministic (RFC 8032), so the same account always derives the
   same key — stable across devices, survives localStorage loss. The message binds
   the network + token id (so a signature for one deployment can't derive keys for
   another). This is the piece the earlier (rejected) server-managed design missed.
2. **`@ctd/sdk` signs Stellar txs via an external `Signer`** (`{publicKey,
   sign(txXdrBase64)}`), and **UltraHonk proofs are generated in the browser** via
   bb.js. `packages/app/lib/freighter.ts` adapts Freighter to `Signer` +
   `signMessage`; `packages/app/lib/bb-loader.ts` + `packages/app/next.config.mjs`
   set up browser bb.js (vendored to `public/vendor/bb/`, COOP=same-origin +
   COEP=credentialless for SharedArrayBuffer, `transpilePackages:["@ctd/sdk"]`).

**Committed design — client-side, driven by the connected Stellar Wallets Kit wallet:**

- **The merchant's confidential identity is derived from the connected wallet's
  `signMessage`** (Stellar Wallets Kit exposes `signMessage` — the same static API
  as `signTransaction`). No server holds the merchant's confidential key; the hidden
  balance is genuinely the user's.
- **Confidential ops (`register`/`deposit`/`merge`/`confidential_transfer merchant→E`)
  run in the BROWSER** via `@ctd/sdk`: `Signer` = a Stellar-Wallets-Kit adapter
  (`kit.signTransaction` for the envelope, `kit.signMessage` for key derivation),
  UltraHonk proofs via browser bb.js. Ports `packages/app/lib/{derive-key,freighter,
  bb-loader}.ts` (adapt `freighter.ts` → a kit adapter) + the `next.config.mjs`
  cross-origin-isolation/webpack setup.
- **The registry `create_shipment(rail=Confidential, escrow=E, amount=0)`** is the
  existing wallet two-step (server builds → wallet signs → server submits), source =
  the connected wallet. Unchanged.
- **The escrow account `E` stays app-managed (client-generated per shipment) —
  it is NOT the user's wallet.** `E` gets a fresh Stellar keypair + a Grumpkin key
  (a random scalar, or derived from `E`'s own Stellar key); its keys travel in the
  shipment packet/mailbox. Holding `E`'s key is a *capability*, not spending
  authority — the token hooks cross-call `registry.release_allowed(id, to)` and
  reject any move the state machine disallows (`EscrowReleaseNotAllowed = 4302`).
  Client-hold `E`'s key in the packet (like the CLI's `escrow.json`); the settle
  (`E → payout`) is a browser-signed confidential_transfer admitted by the hook
  after Delivered.
- **Wallet constraint (state it in the UI + README):** the derive-key trick needs a
  DETERMINISTIC ed25519 `signMessage`, which **Freighter** guarantees. Other kit
  wallets (Albedo/xBull/Lobstr/Hana/Rabet) may not sign deterministically or may not
  support `signMessage` — so the confidential rail requires Freighter (gate it: if
  the connected wallet isn't Freighter, disable the confidential rail with a note).
  The transparent + drone rails still work with any wallet.

This is heavier on the CLIENT (browser bb.js, COOP/COEP, `@ctd/sdk` in the client
bundle) but needs NO server-held confidential keys and makes the hidden amount the
user's own. If browser bb.js proving proves intractable in the dashboard's Next
build within the budget, the documented fallback (a server-side proving path with a
per-session derived key) is a reviewer decision — but the client-side path is the
committed target because the upstream demo has already solved every sub-problem and
ships the code.

## Current state

**The stub** — `dashboard/lib/server/flows.ts:180-192`:
```ts
const rail: Rail = p.rail === "confidential" ? "confidential" : "transparent";
if (rail === "confidential") {
  throw new Error(
    "confidential-rail create is not wired into the wallet flow this pass; " +
      "use the transparent rail (the audit route returns the proven confidential result)",
  );
}
```
Transparent path continues below and always passes `scNone()` for the escrow arg.

**The canned audit** — `dashboard/lib/server/flows.ts:458-469` (`auditFlow`) returns
a HARDCODED `{ amountXlm: "50", note: "…500000000 units = 50 XLM…settle tx 2d990d64…" }`;
it does NOT call `@ctd/sdk`. `dashboard/app/api/confidential/audit/route.ts` is a
thin wrapper. The Auditor panel shows this canned value.

**The CLI that already does it (logic to port)** — `prover/src/confidential.ts`
(644 lines). Key functions (all `cmd*(flags)`, dispatched by `main()`):
- `cmdSetupMerchant` (:244) — `ensureRegistered` + `submitDeposit` + `submitMerge`;
  merchant signer = `keypairSigner(keystoreSecret('relay-merchant'))` (:252),
  merchant Grumpkin = `loadOrCreateRoleKeys('merchant', addrF)` (:253).
- `cmdFundEscrow` (:273) — `const eKp = Keypair.random()` (:282), friendbot-fund
  (:283), `eSigner = keypairSigner(eKp.secret())` (:285), `eKeys = deriveKeys(randomScalar(), addrF)`
  (:286); `ensureRegistered(client, eSigner, eKp.publicKey(), eKeys)` (:290);
  merchant→E `buildTransferWitness({keys: merchantKeys, …, pvkB: eKeys.PVK, …})` +
  `submitTransfer(client, merchantSigner, merchantPub, eKp.publicKey(), …)` (:308-318);
  `submitMerge(client, eSigner, eKp.publicKey())` (:327); persist E's Stellar secret +
  Grumpkin + opening `(v,r)` to `escrow.json` (:338-348, shape at :191-204).
- `cmdCreateShipment` (:355) — CLI `stellar contract invoke create_shipment` with
  `amount 0`, `milestones [10000]`, `rail 1`, `escrow Some(E)`, `token = ctToken` (:378-394).
- `escrowTransfer` (:449-486) — the settle/refund core: `eKeys = deserializeKeys(esc.grumpkin)`
  (:456), `eSigner = keypairSigner(esc.stellarSecret)` (:457), `buildTransferWitness({keys: eKeys, …, pvkB: toAccount.viewingPublicKey})` (:471), `submitTransfer(client, eSigner, esc.escrow, to, …)` (:481). `cmdSettle` (:488) calls it with `to = payout`; `cmdRefund` (:531) with `to = merchant`.
- `cmdAudit` (:573) — REAL decrypt: `fetchEvents` + `auditTransfer(regulatorKey, ev)`.
- `makeClient(dep)` (:130) — `new ChainClient({rpcUrl, networkPassphrase, contracts:{token, verifier, auditor}})`. `loadCircuitJson('register'|'withdraw'|'transfer')` (:171) resolves `@ctd/sdk/circuits/${name}.json`.

**@ctd/sdk** — `prover/package.json:11`: `"@ctd/sdk": "file:../../ct-demo/packages/sdk"`
(physical: `/Users/dadadave/Dev/Stellar/ct-demo/packages/sdk`). **The dashboard does
NOT depend on it** (grep `dashboard/package.json` → none). `Signer` interface:
`ct-demo/packages/sdk/src/chain/client.ts:33-38`. Version skew: prover pins
`@stellar/stellar-sdk ^13.3.0`, dashboard `^16.0.1`.

**The deploy recipe** — `prover/scripts/deploy-all.mjs:214-297`: deploy verifier
(`--admin --manager`), auditor (same), token (`--underlying_asset NATIVE_SAC
--verifier --auditor --registry <REGISTRY>`) — the trailing `--registry` is the
§6.6 pin; register 6 VKs from `@ctd/sdk/circuits/vks/*.vk.bin`; register auditor key
0 (secret → `prover/out/auditor-key.json`); addr_f parity guard; then
`registry.set_ct_token(token)`. `contracts-ct/` MUST be built with
`stellar contract build` (not cargo) — `CLAUDE.md:12`, `contracts-ct/README.md:11`.

**The registry↔token pin is set-once and immutable** — the current CT token
`CAIRUFAA…` is permanently pinned to the OLD registry `CC4HXX…`. The CURRENT
registry `CAROLAUWCNZGSLSAISY5OVY5GZDZ6ULPBAO3U4FKTU3OIAOVPO6ZKPZL` has NOT had
`set_ct_token` called yet (`docs/testnet.md` CURRENT section). So a new CT token
pinned to `CAROLAUW…` can be deployed and pinned; the old one cannot be repointed.

**Registry confidential-create requirements** — `contracts/aegis-registry/src/lib.rs`
`create_shipment` confidential branch: CT token wired (`CtTokenUnset` else), `escrow =
Some(E)` (`EscrowRequired` else), `amount == 0` (`AmountInvalid` else), `milestones ==
[10000]` (`BadMilestones` else), E not already mapped (`EscrowInUse` else); records
`Escrow(E) → id`; no funds enter the registry. `escrow_of`/`release_allowed` are the
hook views. Confidential deliver/refund skip the registry transfer (amount 0).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Build CT contracts | `cd contracts-ct && stellar contract build` | wasms in `contracts-ct/target/wasm32v1-none/release/` |
| Dashboard lint | `cd dashboard && bun run lint` | exit 0 |
| Dashboard build | `cd dashboard && bun run build` | exit 0 |
| Stellar CLI deploy/invoke | `stellar contract deploy/invoke … --rpc-url $RPC --network-passphrase "Test SDF Network ; September 2015"` | success |

RPC: use the Alchemy URL in `dashboard/.env.local` `STELLAR_TESTNET_RPC_URL` (the
public RPC / local proxy have flaky DNS in this sandbox). Keys `relay-admin`,
`relay-merchant` are in the `stellar keys` keystore.

## Scope

**In scope**:
- `prover/scripts/deploy-ct-repin.mjs` (new — Phase 0; a trimmed `deploy-all.mjs`
  that REUSES the current registry instead of deploying a new one)
- `dashboard/package.json` (add `@ctd/sdk`)
- `dashboard/lib/server/confidential.ts` (new — ports the confidential.ts ops to a
  server module using server-managed keys)
- `dashboard/lib/server/flows.ts` (unstub the confidential branch of `buildCreate`;
  add a confidential-settle flow; make `auditFlow` a real decrypt)
- `dashboard/lib/server/store.ts` (persist the per-shipment escrow record)
- `dashboard/app/api/confidential/{setup,settle}/route.ts` (new routes as needed)
- `dashboard/lib/server/artifacts.ts` + `dashboard/components/console/config.ts` +
  `docs/testnet.md` (new CT token/verifier/auditor ids)
- `dashboard/components/console/RolePanels.tsx` (Merchant confidential path UX +
  the settle step; real Auditor decrypt)
- `dashboard/lib/api.ts` + `dashboard/lib/types.ts` (any new request/response shapes)
- `README.md` / `dashboard/README.md` (the honest caveat about the server-managed
  confidential funder)

**Out of scope**:
- Do NOT modify `contracts/` (the registry is already correct) or
  `contracts-ct/` source (redeploy the existing wasm, don't change hooks).
- Do NOT touch `prover/src/confidential.ts` (port its logic; leave the CLI intact).
- Do NOT change the transparent or drone flows.
- Do NOT run bb.js UltraHonk proving in the browser bundle (server-side only) unless
  the client-side path proves trivially easy (see the design decision).

## Git workflow

- Branch `advisor/004-wire-confidential-rail`; conventional commits per phase.
- Do NOT push; do NOT commit any secret (auditor/funder/E secrets live only in
  gitignored `prover/out/**` or `dashboard/.demo-state/**`). Scan staged diffs:
  `git diff --cached | grep -cE 'S[A-Z2-7]{55}'` must be 0.

## Phases

### Phase 0 — Redeploy the CT token re-pinned to the current registry (PREREQUISITE)

Write `prover/scripts/deploy-ct-repin.mjs` by trimming `deploy-all.mjs`: SKIP the
Aegis registry/airspace/credentials deploy (:184-211) and the corridor/root setup
(:299+); KEEP the CT stack (:214-297) with `registry` set to the CURRENT registry
constant `CAROLAUWCNZGSLSAISY5OVY5GZDZ6ULPBAO3U4FKTU3OIAOVPO6ZKPZL`. Reuse
`relay-admin`. Steps the script performs (mirror deploy-all.mjs exactly):
1. `cd contracts-ct && stellar contract build` (or assume pre-built; verify the 3
   wasms exist).
2. Deploy verifier (`--admin --manager` = relay-admin), auditor (same), token
   (`--underlying_asset <NATIVE_SAC> --verifier <v> --auditor <a> --registry CAROLAUW…`).
3. Register the 6 VKs from `@ctd/sdk/circuits/vks/*.vk.bin`.
4. Register auditor key 0 (secret → `prover/out/auditor-key.json`).
5. addr_f parity guard.
6. `registry.set_ct_token(<newToken>)` on `CAROLAUW…` (this is the first pin on the
   new registry, so it succeeds; it will `AlreadySet`-fail if run twice).
7. Write a deployment record the server can read (see Phase A): the new
   token/verifier/auditor ids + rpc + passphrase + deployedAtLedger, to
   `dashboard/.demo-state/ct-deployment.json` (gitignored) AND print them.

**Verify**:
- `stellar contract invoke <CAROLAUW…> --send=no -- ct_token` → returns the new token id (pin closed).
- `stellar contract invoke <newToken> --send=no -- <a read fn>` succeeds.
- Update `artifacts.ts` `CT_TOKEN_ID`/`CT_AUDITOR_ID` (+ a new `CT_VERIFIER_ID`),
  `components/console/config.ts`, and `docs/testnet.md` with the new ids. Grep the
  old `CAIRUFAA…` in dashboard → gone (except the archived docs section).

**STOP** if `stellar contract build` fails for any reason other than a missing
toolchain you can install, or if `set_ct_token` returns `AlreadySet` (means the new
registry was already pinned — read `ct_token` and reuse that token instead of
deploying a second one).

### Phase A — Server confidential module (`dashboard/lib/server/confidential.ts`)

1. Add `@ctd/sdk` to `dashboard/package.json`:
   `"@ctd/sdk": "file:../../ct-demo/packages/sdk"` (same as prover). Run
   `cd dashboard && bun install`. **STOP and report** if the install fails on the
   `@stellar/stellar-sdk` peer (dashboard 16 vs sdk's 13) — the resolution strategy
   (dedupe, override, or a pinned dual-install) is a decision for the reviewer.
2. Port the CLI ops into exported functions that take server-managed keys (model
   each on the cited `cmd*`/helper in `prover/src/confidential.ts`, but replace the
   `keystoreSecret('relay-merchant')` signer with a server-generated **confidential
   funder** keypair, and use `@ctd/sdk` types directly):
   - `ensureFunderReady(): Promise<void>` — generate (once, persisted to gitignored
     `dashboard/.demo-state/ct-funder.json`) the funder Stellar keypair + Grumpkin
     key; friendbot-fund; `register` + `deposit(<float>)` + `merge` (ports
     `cmdSetupMerchant` :244-271).
   - `fundEscrow(shipmentLabel, amountUnits): Promise<{escrowAddr}>` — ports
     `cmdFundEscrow` :273-353: fresh E, friendbot, register E, funder→E transfer,
     merge E; persist E's record (`stellarSecret`, `grumpkin`, `opening`, `token`,
     `registry`) into the mailbox (`store.ts`), NOT stdout. Return only E's address.
   - `settleEscrow(shipmentId, escrowRecord, payout): Promise<{tx}>` — ports
     `escrowTransfer` :449-486 with `to = payout`; hook admits it iff the shipment
     is Delivered.
   - `refundEscrow(shipmentId, escrowRecord, merchant)` — same with `to = merchant`.
   - `auditLast(): Promise<{amountXlm, txHash}>` — ports `cmdAudit` :573-597: real
     `fetchEvents` + `auditTransfer` with `loadAuditorKey()`.
   Circuits: reuse `loadCircuitJson` via `import.meta.resolve("@ctd/sdk/circuits/…")`
   (works in the Next node runtime; if it doesn't, read from the resolved package
   path — STOP-and-report if neither resolves).
3. **Verify** in isolation before touching the UI: a small node harness (in
   `dashboard/`, gitignored) that calls `ensureFunderReady()` then
   `fundEscrow("t", 500000000n)` against the Phase-0 token and prints E's address +
   confirms `registry.escrow_of(E)` is still None (not yet created) — proving the
   confidential funding path runs in the dashboard's node context. **STOP and
   report** if bb.js UltraHonk proving fails to run in the Next node runtime (the
   fallback — a separate proving process — is a reviewer decision, not something to
   improvise).

### Phase B — Unstub confidential create in `buildCreate`

Replace the `throw` (`flows.ts:183-190`) with the confidential path:
1. `await ensureFunderReady()`.
2. `const { escrowAddr } = await fundEscrow(<label>, <amountUnits>)` where the
   amount comes from the create form (the hidden escrow value).
3. Build `create_shipment` with `rail = Confidential (1)`, `escrow = scSome(Address(escrowAddr))`,
   `amount = 0`, `milestones = [10000]`, `token = CT_TOKEN_ID` — as the connected
   wallet's wallet-signed two-step (the existing `buildInvoke` path; the merchant
   arg + source = the connected wallet). Store the escrow record under the returned
   shipmentId in the mailbox on submit.
Keep transparent behavior byte-identical.

**Verify**: with a funded test wallet, POST the confidential create through the
existing `/api/tx/build`→sign→`/api/tx/submit`; `status(id)` shows `rail = confidential`,
`amount = 0`; `escrow_of(E) = id`.

### Phase C — Settle + real audit

1. Add `POST /api/confidential/settle {shipmentId}` → after the shipment is
   Delivered, call `settleEscrow(...)` with the stored escrow record + the stored
   payout; return the tx. (Refund path optional; wire if time permits.)
2. Rewrite `auditFlow` (`flows.ts:458-469`) to call `auditLast()` (real decrypt) and
   return the decrypted amount + tx; keep the graceful fallback to the recorded
   value ONLY if the live decrypt throws (and say so in the note).

**Verify**: confidential create → carrier accept → deliver → settle → the payout's
confidential balance increases; `/api/confidential/audit` returns the real decrypted
amount (not the hardcoded string).

### Phase D — UI + docs

1. Merchant panel: on `rail = confidential`, show a "provisioning confidential
   escrow…" state during Phase-B funding; surface E's address + the "amount hidden"
   note. Carrier panel: after deliver on a confidential shipment, show a **Settle**
   button (→ `/api/confidential/settle`). Auditor panel: the decrypt now hits the
   real route.
2. README + dashboard/README: the honest caveat (server-managed confidential
   funder; server holds Grumpkin viewing keys; amount genuinely hidden on-chain;
   production would move the key to the wallet). Update `docs/testnet.md` +
   `docs/DEMO-ARCHITECTURE.md` confidential section to "wired" with the new CT ids.

**Verify**: `bun run lint` + `bun run build` exit 0; a full confidential lifecycle
clicks through in the console (create → accept → deliver → settle → auditor decrypt).

## Test plan

No dashboard test runner. Gates: `bun run lint`/`bun run build`, the Phase-A node
harness, and a live confidential lifecycle on testnet (Phase C verify). Contract
behavior is already covered by `contracts/aegis-registry` tests + the
`contracts-ct` hook tests — do not duplicate; this plan is integration only.

## Done criteria

- [ ] Phase 0: `registry.ct_token()` on `CAROLAUW…` returns the newly-deployed
      token; new CT ids wired into `artifacts.ts`/`config.ts`/`docs/testnet.md`.
- [ ] `dashboard/package.json` depends on `@ctd/sdk`; `bun install` succeeds.
- [ ] `dashboard/lib/server/flows.ts` no longer contains the confidential `throw`;
      `grep -n "not wired into the wallet flow" dashboard/lib/server/flows.ts` → none.
- [ ] `auditFlow` calls the real decrypt (no hardcoded "500000000"/"2d990d64" as the
      primary return path).
- [ ] `bun run lint` + `bun run build` exit 0.
- [ ] A live confidential lifecycle on testnet: create (amount hidden, `status`
      shows amount 0 + rail confidential) → accept → deliver → settle (payout
      confidential balance up) → auditor decrypt returns the real amount.
- [ ] No secret committed (`git diff … | grep -cE 'S[A-Z2-7]{55}'` == 0); funder/E/
      auditor secrets only under gitignored `.demo-state/**` or `prover/out/**`.
- [ ] Only in-scope files modified.

## STOP conditions

- `stellar contract build` for `contracts-ct` fails (toolchain), or `set_ct_token`
  returns `AlreadySet` (registry already pinned — reuse the existing token).
- `bun install` of `@ctd/sdk` cannot resolve the `@stellar/stellar-sdk` peer across
  the 13↔16 major boundary — report the error; the resolution is a reviewer call.
- bb.js UltraHonk proving does not run in the Next node runtime (Phase A harness
  fails) — report; the fallback (separate proving process, or client-side proving)
  is a design decision, not an improvisation.
- A confidential tx is rejected by a hook with an UNEXPECTED code (anything other
  than the intended `4302` on a premature settle) — STOP; the escrow/registry
  wiring is wrong.
- The plan would require editing `contracts/` or `contracts-ct/` source — STOP
  (the contracts are correct; this is integration only).

## Maintenance notes

- **The confidential funder + escrow keys are server-held.** This is the documented
  demo affordance (safe for E by the hook cage; a viewing-key exposure for the
  funder). The production evolution is client-side `@ctd/sdk` + wallet `Signer` +
  a wallet-held Grumpkin key + browser bb.js proving — the SDK already supports the
  first two; note this for whoever hardens it.
- **Confidential rail is single-milestone `[10000]` only** (the registry never
  learns the amount, so bps math is impossible) — the create form must force
  `[10000]` when rail = confidential.
- A reviewer should scrutinize: no secret leaves `.demo-state`/`prover/out`; the
  settle is gated so it can only succeed after Delivered (the hook enforces it, but
  the UI should not offer it earlier); and the stellar-sdk version resolution didn't
  silently break the transparent rail's tx building.
- If Phase A's SDK integration proves intractable in the time budget, a valid
  reduced deliverable is **Phase 0 + a real `auditFlow` decrypt only** (make the
  Auditor beat live against a freshly re-pinned token using the CLI to seed one
  confidential shipment) — that removes the canned value without the full create
  wiring. Record that as the fallback scope.
