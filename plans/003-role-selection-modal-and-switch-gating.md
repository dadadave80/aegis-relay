# Plan 003: First-connect role modal + on-chain-gated role switching

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat d65bd16..HEAD -- dashboard/`
> Also confirm plans 001 and 002 are DONE (see `plans/README.md`). This plan
> edits files that plan 002 renames and calls contract entrypoints that plan 001
> adds; if either is not landed, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (new modal + gating logic; depends on a redeployed contract)
- **Depends on**: plans/001-onchain-role-binding.md (deployed), plans/002-real-app-remove-demo-and-attacker.md
- **Category**: feature
- **Planned at**: commit `d65bd16`, 2026-07-03

## Why this matters

Deliver the role UX the product calls for, on top of the on-chain enforcement
from plan 001:

- **First time a wallet connects, a modal with a dropdown prompts the user to
  pick a role** (merchant, carrier, recipient, auditor).
- **A wallet holds one role at a time, and can switch only when it has no active
  service.** The registry already enforces this (plan 001: `create_shipment` and
  `accept` auto-bind the wallet's role and reject a conflicting role while the
  wallet has active services — `WrongRole`; `set_role` rejects a switch while
  active — `RoleLocked`). This plan makes the UI *reflect and pre-empt* that:
  it reads `active_count(addr)` from the contract and disables the role switcher
  while the wallet has active services, with a clear reason, so the user never
  hits a raw on-chain rejection for switching.

Role selection is instant (client-side) — no transaction is required just to
pick a role. The binding is recorded on-chain automatically on the wallet's
first `create_shipment`/`accept` (plan 001's auto-bind), and the contract is the
final arbiter. The UI's job is to (a) prompt the pick, (b) reflect any already-
bound on-chain role, and (c) gate switching on the live `active_count`.

## Current state

**Depends on plan 001's new entrypoints** (in `contracts/aegis-registry`,
redeployed): `role_of(addr) -> Option<Role>` and `active_count(addr) -> u32`.
The redeployed registry id must already be in
`dashboard/components/console/config.ts` (`FALLBACK_CONTRACTS.registry`) and
`dashboard/lib/contract.ts` — verify before starting (Step 0).

**Depends on plan 002's structure**: components live under
`dashboard/components/console/` and the route is `dashboard/app/console/`; the
`Role` union has four members (no attacker); the role switcher shows four roles.

**Console gating today** — `dashboard/components/console/Console.tsx` (was
`components/demo/Console.tsx`, 53 lines): `if (!stellarAddress) return <LoginScreen />;`
then renders `<TopBar/> <RoleSwitcher/> <ActionPanel role={role}/> <LifecycleBoard/>`.
There is **no role-selection modal** — role defaults to `"merchant"` in
`session-context`. The modal must be inserted between the wallet gate and the
console body.

**RoleSwitcher today** — `dashboard/components/console/RoleSwitcher.tsx`: a
tablist calling `setRole(r.role)` unconditionally (no gate).

**Session context** — `dashboard/lib/session-context.tsx`: `role` +
`setRole` (persisted to `localStorage["aegis-demo-role"]`). No per-wallet
"has picked a role" flag and no `activeCount`.

**Wallet context** — `dashboard/lib/wallet-context.tsx`: `useWallet()` exposes
`stellarAddress: string | null` and `ready`. The address is here, not in
session-context — so the on-chain role read (which needs the address) belongs in
a component/hook that has `useWallet()`.

**Server read pattern** — `dashboard/lib/server/soroban.ts` has
`readShipmentRaw(id)` and `nativeBalanceXlm(address)` showing how to read the
contract via RPC (`server()`, `simulateInvoke`/`getAccount`). A new role read
follows the same shape. `dashboard/app/api/shipment/[id]/route.ts` is the pattern
for a GET route returning `ActionResult<T>`.

**Client api layer** — `dashboard/lib/api.ts`: `get`/`post` helpers returning
`ActionResult<T>`; add a `roleInfo` wrapper here.

**No existing modal/dialog or `<select>` in the codebase** — build the modal from
the design primitives (`components/console/primitives.tsx`: `ActionButton`,
`Field`, `SectionLabel`; CSS vars `--bg`, `--border`, `--mint`, `--on-mint`,
`card`, `rounded-xl`). Use a native `<select>` for the dropdown (accessible, no
new dependency). Toasts available via `components/console/toast.tsx`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Lint | `cd dashboard && bun run lint` | exit 0 |
| Build | `cd dashboard && bun run build` | exit 0; `/api/role` in the route list |

## Scope

**In scope**:
- Create `dashboard/app/api/role/route.ts` (GET role_of + active_count).
- Add a `roleInfo` reader to `dashboard/lib/server/soroban.ts` (or a small
  `lib/server/role.ts`) + wire it in the route.
- Add `RoleInfo` type to `dashboard/lib/types.ts` + `api.roleInfo` to `dashboard/lib/api.ts`.
- Create `dashboard/components/console/RoleModal.tsx`.
- Edit `dashboard/components/console/Console.tsx` (mount the modal on first connect).
- Edit `dashboard/components/console/RoleSwitcher.tsx` (gate switching on `activeCount`).
- Edit `dashboard/lib/session-context.tsx` (per-wallet "role chosen" flag).

**Out of scope**:
- Do NOT change `create_shipment`/`accept`/`deliver` flows — the on-chain binding
  is automatic (plan 001). This plan only *reads* `role_of`/`active_count` and
  gates the UI.
- Do NOT add a `set_role` transaction to the pick flow — selection is client-side;
  the contract binds on first action. (See maintenance notes for the alternative.)
- Do NOT touch `contracts/` — plan 001 owns the contract.

## Git workflow

- Branch: `advisor/003-role-selection-modal`.
- Commit style: `feat(dashboard): first-connect role modal + active-gated switching`.
- Do NOT push unless asked.

## Steps

### Step 0: Confirm the redeployed registry id is wired

`grep -n "registry" dashboard/components/console/config.ts dashboard/lib/contract.ts`
— the `registry` id must be the one redeployed with plan 001's entrypoints. If it
is still `CC4HXXHUE6ZCIVVN4XAHPV4JMYHEWK7ZIKILQMG5WCJ4V67NWLFTVGCA` (the pre-001
deployment) and plan 001 was redeployed to a new id, **STOP** and get the new id
in first. If plan 001 was deployed to the same id via upgrade, proceed.

### Step 1: Server — read `role_of` + `active_count`

Add to `dashboard/lib/server/soroban.ts` a reader that calls the two view
entrypoints on the registry (model on `readShipmentRaw`/`nativeBalanceXlm`):

```ts
export async function readRole(address: string): Promise<{ role: string | null; activeCount: number }> {
  // simulate role_of(address) and active_count(address) against REGISTRY,
  // decode scValToNative. role_of returns an enum → map 0→"merchant", 1→"carrier".
  // active_count returns u32. On any read error, return { role: null, activeCount: 0 }.
}
```
Use `simulateInvoke(REGISTRY, "role_of", [addressScVal])` and `("active_count", …)`
(mirror how `readShipmentRaw` builds args + reads the simulation return). The
`Role` enum decodes as a u32-tagged value; map `0 → "merchant"`, `1 → "carrier"`,
absent/None → `null`.

Create `dashboard/app/api/role/route.ts`:

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { readRole } from "@/lib/server/soroban";
// GET /api/role?address=G... → ActionResult<RoleInfo>
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address");
  if (!address) return NextResponse.json({ ok: false, error: "address required" });
  try {
    return NextResponse.json({ ok: true, data: await readRole(address) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
```

Add to `dashboard/lib/types.ts`:
```ts
export interface RoleInfo { role: Role | null; activeCount: number }
```
(Note: on-chain `role_of` only returns merchant/carrier; `RoleInfo.role` is the
on-chain-bound role or null — recipient/auditor never bind on-chain.)

Add to `dashboard/lib/api.ts`:
```ts
roleInfo: (address: string) => get<RoleInfo>(`/api/role?address=${encodeURIComponent(address)}`),
```
(import `RoleInfo` in the type import list.)

**Verify**: `cd dashboard && bun run build` → exit 0, route list includes `ƒ /api/role`.

### Step 2: Session — track whether this wallet has picked a role

`dashboard/lib/session-context.tsx`: add per-wallet "role chosen" tracking so the
modal shows only the first time. Add to the context value:

```ts
  /** True once the user has picked a role for the connected wallet. */
  hasChosenRole: boolean;
  /** Record the pick for a wallet (persists per-address). */
  chooseRole: (address: string, r: Role) => void;
  /** Recompute hasChosenRole for the connected wallet (call on connect). */
  syncChosen: (address: string | null, onchainRole: Role | null) => void;
```

Persist a per-wallet key `aegis-role-chosen-<address>` = the chosen role. On
`syncChosen`: if an on-chain role exists, treat the wallet as having chosen
(set role to it, mark chosen). Else read the per-wallet localStorage key; if
present, set role + chosen; else `hasChosenRole = false` (modal will show).
`chooseRole` writes the per-wallet key, calls `setRole(r)`, sets `hasChosenRole = true`.

Keep the existing `role`/`setRole`. (Switching via the switcher updates `role`
and, when it's a deliberate switch, also `chooseRole` for the current wallet.)

**Verify**: `grep -n "hasChosenRole\|chooseRole\|syncChosen" dashboard/lib/session-context.tsx`
→ present; `cd dashboard && bun run build` → exit 0.

### Step 3: The role modal

Create `dashboard/components/console/RoleModal.tsx` — a fixed overlay with a card
containing a heading, a native `<select>` dropdown (the four roles from `ROLES`
in `./config`), a short description of the selected role (`roleMeta(sel).acting`),
and a "Continue" `ActionButton`. On continue, call `chooseRole(address, sel)`.

Shape (match the design system — dark card, `--mint` accent, `rounded-xl`, 44px
targets; overlay `position: fixed; inset: 0` with a dimmed backdrop):

```tsx
"use client";
import { useState } from "react";
import { ROLES, roleMeta } from "./config";
import { ActionButton } from "./primitives";
import type { Role } from "@/lib/types";

export default function RoleModal({ onPick }: { onPick: (r: Role) => void }) {
  const [sel, setSel] = useState<Role>("merchant");
  return (
    <div role="dialog" aria-modal="true" aria-label="Choose your role"
         className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "color-mix(in srgb, black 65%, transparent)" }}>
      <div className="card p-6 w-full max-w-md">
        <h2 className="text-xl font-semibold tracking-tight">Choose your role</h2>
        <p className="text-sm mt-1.5" style={{ color: "var(--text-dim)" }}>
          A wallet holds one role at a time. You can switch later once you have no
          active shipment.
        </p>
        <label className="block text-sm mt-5 mb-1" style={{ color: "var(--text-dim)" }}>Role</label>
        <select value={sel} onChange={(e) => setSel(e.target.value as Role)}
                className="w-full rounded-xl px-3 min-h-[44px] text-sm"
                style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}>
          {ROLES.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
        </select>
        <p className="text-sm mt-3" style={{ color: "var(--text-faint)" }}>{roleMeta(sel).acting}</p>
        <ActionButton className="w-full mt-6" onClick={() => onPick(sel)}>Continue →</ActionButton>
      </div>
    </div>
  );
}
```

**Verify**: `cd dashboard && bun run build` → exit 0.

### Step 4: Mount the modal on first connect (Console)

`dashboard/components/console/Console.tsx`: after the wallet gate
(`if (!stellarAddress) return <LoginScreen />;`), fetch role info once per
connected address and drive the modal:

- On `stellarAddress` change, call `api.roleInfo(stellarAddress)` and then
  `syncChosen(stellarAddress, info.role)`; store `activeCount` in session (add an
  `activeCount` field + setter to session-context, or lift into Console state and
  pass to RoleSwitcher via context/props).
- If `!hasChosenRole`, render `<RoleModal onPick={(r) => chooseRole(stellarAddress, r)} />`
  (over a dimmed console or alone).
- Else render the console as today.

Keep the not-ready spinner branch. Order: not-ready → spinner; no wallet →
LoginScreen; wallet but role not chosen → RoleModal; else console.

**Verify**: `cd dashboard && bun run build` → exit 0. Manual (if a wallet is
available): connect a fresh wallet → the modal appears; pick a role → console
renders; reload → modal does NOT reappear (persisted).

### Step 5: Gate the role switcher on `active_count`

`dashboard/components/console/RoleSwitcher.tsx`: read `activeCount` (from session
context, populated in Step 4). When `activeCount > 0`, disable every tab except
the current role and show a one-line reason; when `0`, switching is enabled.

- Add `disabled={activeCount > 0 && r.role !== role}` to each tab button, with
  `style` dimming (`opacity: 0.45`, `cursor: not-allowed`) and
  `aria-disabled`. The active tab stays interactive.
- Replace the hint line with a conditional: when `activeCount > 0`, show
  "You have an active shipment — finish or let it expire to switch roles."; else
  the existing "You are now acting as …" line.
- On a valid switch (activeCount 0), call `setRole(r.role)` AND
  `chooseRole(stellarAddress, r.role)` so the new pick persists for this wallet.

Note: this is a UI pre-empt; the contract is the backstop (an active merchant who
somehow reached `accept` still gets `WrongRole`). Do not remove that backstop —
just prevent the user from trying.

**Verify**: `cd dashboard && bun run build` → exit 0.

### Step 6: Refresh `activeCount` after lifecycle actions

Whenever an action changes on-chain state (create/accept/deliver/refund),
re-fetch `api.roleInfo(stellarAddress)` so the switcher unlocks promptly after a
shipment reaches a terminal state. The simplest hook: in Console, re-call
`roleInfo` inside the same effect that reacts to `session.shipment` changes (the
board already re-reads the shipment after each mutation via
`session.refreshShipment`). Add a `roleInfo` refetch there.

**Verify**: `cd dashboard && bun run build` → exit 0; `bun run lint` → exit 0.

## Test plan

No dashboard test runner exists; gates are lint + build + manual smoke:

- `bun run build` passes with `/api/role` present.
- Manual (needs a testnet wallet with the plan-001 registry live):
  1. Connect a fresh wallet → RoleModal appears; the dropdown lists exactly
     Merchant/Carrier/Recipient/Auditor.
  2. Pick Merchant → console renders; create a shipment → `active_count` becomes
     1 → the switcher locks (other roles disabled) with the reason shown.
  3. Complete the lifecycle (or `refund_expired` after the deadline) → the
     shipment goes terminal → the switcher unlocks.
  4. Reload with the same wallet → no modal (role remembered); if the wallet has
     an on-chain-bound role, it is preselected.
- Contract backstop check: with the switcher somehow bypassed, an active
  merchant calling `accept` returns `WrongRole` (verified in plan 001's tests).

## Done criteria

ALL must hold:

- [ ] `cd dashboard && bun run build` exits 0; route list includes `/api/role`.
- [ ] `cd dashboard && bun run lint` exits 0.
- [ ] `grep -rn "RoleModal" dashboard/components/console dashboard/app` → the modal
      is created and mounted in Console.
- [ ] `grep -rn "roleInfo\|active_count\|activeCount" dashboard/lib dashboard/components/console`
      → the read is wired and the switcher consumes it.
- [ ] No `set_role` transaction is triggered by role selection (selection is
      client-side): `grep -rn "set_role\|setRole.*buildTx\|action: \"setRole\"" dashboard`
      → no on-chain set_role call from the pick flow.
- [ ] No files outside the in-scope list are modified (`git status`).
- [ ] `plans/README.md` status row for 003 updated.

## STOP conditions

Stop and report if:

- Plan 001's `role_of`/`active_count` are not callable on the configured registry
  id (Step 0 mismatch, or a read returns a contract error) — the redeploy is the
  blocker.
- `simulateInvoke` cannot decode the `Role` enum return (the u32 mapping is
  wrong) — report the raw scVal so the mapping can be fixed.
- The build fails after the modal mount with a hook-order/SSR error from the
  `<select>` or the fixed overlay — report the error; the modal must be a client
  component rendered only after `ready`.
- Reflecting `activeCount` would require changing a create/accept flow (it should
  not — those are read-only reads here).

## Maintenance notes

- **Alternative (stronger, more friction):** call the contract's `set_role`
  transaction at pick time so the role is recorded on-chain immediately (not just
  on first action). This makes `role_of` authoritative from the first moment and
  gives an explicit on-chain switch, at the cost of a signed tx (and gas) just to
  pick a role. If the product wants role selection to be an on-chain event, add a
  `setRole` `TxAction` to `lib/types.ts` + `lib/server/flows.ts` (build a
  `set_role` invoke) + a `useWalletFlows().setRole` and call it from RoleModal /
  the switcher. Plan 001 already ships the `set_role` entrypoint and its
  `RoleLocked` guard, so only the client wiring is needed.
- Recipient/auditor are not on-chain roles: `role_of` returns null for them and
  `active_count` stays 0, so the switcher never locks a recipient/auditor wallet —
  correct, since they render no on-chain service.
- A reviewer should confirm the modal cannot be dismissed into a role-less console
  (no way to reach the console without a chosen role), and that `activeCount`
  refetches after terminal-state actions so the switcher doesn't stay stuck
  locked.
