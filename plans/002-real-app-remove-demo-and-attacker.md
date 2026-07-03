# Plan 002: Make it the real app — remove the "demo" framing and the attacker role

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat d65bd16..HEAD -- dashboard/`
> If the dashboard files below changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (a directory rename touches many imports; the build gate catches misses)
- **Depends on**: none (pure frontend; independent of plan 001)
- **Category**: tech-debt / product
- **Planned at**: commit `d65bd16`, 2026-07-03

## Why this matters

Two product decisions:

1. **This is the real application, not a "demo."** Everything is already wired to
   real data — the deployed testnet registry via RPC, real Groth16 proofs, real
   wallet-signed transactions. But the code and copy call it a "demo console"
   (`app/demo/`, `components/demo/`, "Launch demo console", "Interactive demo
   console"). Remove that framing so nothing reads as a toy.
2. **There is no attacker role.** A scripted "Attacker" role that fires
   pre-canned attacks is exactly the gimmick to cut. Malicious actions are caught
   by the protocol's real guards (`BadProof`, `WrongState`, `NullifierSpent`, …,
   and — once plan 001 lands — `WrongRole`/`RoleLocked`). Any user in any role
   who tries something illegal already gets the appropriate on-chain error; no
   dedicated role is needed to show that.

This plan is pure removal + rename + copy edits. It does not add features and
does not depend on the contract change (plan 001) — but plan 003 (the role
modal) builds on the renamed structure this plan produces.

## Current state

**Role type includes attacker** — `dashboard/lib/types.ts:5`:
```ts
export type Role = "merchant" | "carrier" | "recipient" | "auditor" | "attacker";
```
The file header comment (types.ts:1-3) also calls it "the interactive demo" and
references `app/demo/**`.

**Attacker-only types** — `dashboard/lib/types.ts:110-117`: `AttackKind`,
`AttackReq`, `AttackRes`, plus a comment at types.ts:78 ("for the attack beats")
on `ActionResult.errorCode`.

**Client api wrapper** — `dashboard/lib/api.ts:7` imports `AttackReq, AttackRes`;
line 43 exposes `attack: (b: AttackReq) => post<AttackRes>("/api/attack", b)`.

**Server route** — `dashboard/app/api/attack/route.ts` exists and is the only
backend for `api.attack`. (Its flow logic lives in `dashboard/lib/server/flows.ts`
as an `attackFlow`/`attackDeliverProof` — see grep in Step 5.)

**Role metadata** — `dashboard/components/demo/config.ts:45-76`, `ROLES` array;
the 5th entry (config.ts:70-75) is the attacker:
```ts
  { role: "attacker", label: "Attacker", glyph: "✕",
    acting: "an attacker — every shortcut you try is meant to be rejected." },
```

**RoleSwitcher** — `dashboard/components/demo/RoleSwitcher.tsx` renders `ROLES`
as a tablist; it has attacker-specific red styling at lines 27-28, 40, 62 and a
doc comment naming "Attacker" (lines 4-6).

**RolePanels** — `dashboard/components/demo/RolePanels.tsx`:
- imports `AttackKind, AttackRes` (lines 18-19),
- `ATTACKS` array (lines 746-752),
- `AttackerPanel()` (lines 754-852) — the only caller of `api.attack` (line 775),
- the `ActionPanel` switch `case "attacker": return <AttackerPanel />;` (lines 866-867).
The shared helpers `Panel`, `NeedShipment`, `useRunner`, `InlineError`,
`ActionButton` (lines ~55-135) are used by ALL panels — keep them.

**Landing page CTA** — `dashboard/app/page.tsx:51-87`. Eyebrow "Interactive demo
console" (line 69), copy naming attacker (lines 75-76), button "Launch demo
console →" (line 83), `<Link href="/demo" …>` (line 54).

**LoginScreen** — `dashboard/components/demo/LoginScreen.tsx:16` (`BEATS[0].body`)
names "…recipient, auditor and attacker…".

**Session role rehydration is unchecked** — `dashboard/lib/session-context.tsx:81`:
```ts
const r = window.localStorage.getItem(ROLE_KEY) as Role | null;
if (r) setRoleState(r);
```
A returning user whose `localStorage["aegis-demo-role"]` holds `"attacker"` would
re-select it even after the type is removed. Needs a validation guard.

**Demo directories** — `dashboard/app/demo/` (page.tsx, layout.tsx) and
`dashboard/components/demo/` (Console, RoleSwitcher, RolePanels, LifecycleBoard,
TopBar, LoginScreen, config, primitives, toast, SeenVsHidden, CorridorMini,
DemoTimeline). The landing links to `/demo`.

Design system to preserve (do not restyle): dark bg + `--mint` accent, `card`,
`rounded-xl`, min-height 44px touch targets, primitives in
`components/demo/primitives.tsx`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Lint | `cd dashboard && bun run lint` | exit 0 |
| Build | `cd dashboard && bun run build` | exit 0, all routes compile |
| Find leftover "demo" | `grep -rin "demo" dashboard/app dashboard/components dashboard/lib` | only intentional hits (see done criteria) |
| Find leftover "attack" | `grep -rin "attack" dashboard/app dashboard/components dashboard/lib` | no matches |

## Scope

**In scope**:
- Rename `dashboard/app/demo/` → `dashboard/app/console/`
- Rename `dashboard/components/demo/` → `dashboard/components/console/`
- Delete `dashboard/app/api/attack/` (whole route dir)
- Edit: `dashboard/lib/types.ts`, `dashboard/lib/api.ts`,
  `dashboard/lib/session-context.tsx`, `dashboard/app/page.tsx`,
  `dashboard/components/Nav.tsx` (**required** — the `/demo` CTA at Nav.tsx:9
  must become `/console` or nav 404s), `dashboard/app/providers.tsx` (its stale
  `app/demo/page.tsx` comment → `app/console`), and (post-rename) the files under
  `dashboard/components/console/` that reference the attacker or the demo-console
  framing, plus `dashboard/app/console/*`.
- Edit `dashboard/lib/server/flows.ts` to remove the now-unreferenced
  `attackFlow`/`attackDeliverProof` and the `applyAttack` import (flows.ts:26 is
  the only dashboard consumer of prover-dist's attack API — see Step 5).
- `dashboard/README.md` (remove attacker/"demo console" copy).

**Out of scope** (leave; the targeted acceptance greps below will not flag them):
- `dashboard/lib/server/prover-dist/**` — 20 vendored/compiled prover files
  (tracked but generated from `prover/src`). They contain `ATTACK_MODES`,
  `applyAttack`, `AttackMode` and `demo`/`attack` comments — that is the drone-
  simulation crypto, NOT the UI attacker feature. Do NOT edit them; the
  acceptance greps exclude this dir. (After Step 5, nothing in the dashboard app
  imports `applyAttack` — the vendored export simply goes unused, which is fine.)
- `dashboard/lib/server/store.ts` — its `.demo-state` runtime-dir constant is
  load-bearing (the mailbox path); do NOT rename it. Its internal
  "demo mailbox"/"replay attack" comments are server-internal and may be reworded
  but are NOT required (the greps exclude ordinary prose in server internals).
- `dashboard/lib/server/soroban.ts` — internal comments ("attack rejections")
  may be reworded but are not required.
- Ordinary-English "demo" in `dashboard/app/verify/page.tsx`,
  `dashboard/app/map/page.tsx`, `dashboard/app/track/[id]/page.tsx` ("demo
  fixture", "corridor demo", "demo stand-in") and "attack surface" in
  `app/page.tsx:43` — these are normal words, not toy-framing; leave them.
- Do NOT change the on-chain-reading behavior of any route — they already read
  the real deployed contract.
- Do NOT touch `contracts/`, `prover/`, `circuits/`.
- Do NOT restyle/re-lay-out the panels/board; do NOT add the role modal (plan 003).
- Keep the recipient PoD (server-signed) and confidential-audit routes as-is —
  real behavior, not gimmicks.

## Git workflow

- Branch: `advisor/002-real-app-remove-demo-and-attacker`.
- Use `git mv` for the directory renames so history is preserved.
- Commit style (conventional): e.g.
  `refactor(dashboard): remove demo framing and the attacker role`.
- Do NOT push unless asked.

## Steps

### Step 1: Remove the attacker from the shared type layer

`dashboard/lib/types.ts`:
- Line 5 → `export type Role = "merchant" | "carrier" | "recipient" | "auditor";`
- Delete `AttackKind`, `AttackReq`, `AttackRes` (lines 110-117).
- Edit the `errorCode` comment (line 78) to drop "for the attack beats" — the
  field still carries contract error codes (e.g. `Error(Contract, #23)`), so
  reword to: `// e.g. "Error(Contract, #2)" surfaced from a rejected action`.
- Update the header comment (lines 1-3) to drop "demo" wording (e.g. "Shared
  types for the app — the pinned contract between the server API routes and the
  client console.").

`dashboard/lib/api.ts`:
- Remove `AttackReq, AttackRes` from the import (line 7).
- Delete the `attack:` wrapper (line 43).

**Verify**: `grep -rn "AttackKind\|AttackReq\|AttackRes\|api.attack" dashboard/lib`
→ no matches.

### Step 2: Delete the attacker server route

`git rm -r dashboard/app/api/attack`

**Verify**: `test ! -d dashboard/app/api/attack && echo GONE` → prints `GONE`.

### Step 3: Remove attacker flow logic from the server

In `dashboard/lib/server/flows.ts`, find the attacker code (it is dead once the
route is gone):
- `grep -n "attack\|Attack" dashboard/lib/server/flows.ts` — locate the exported
  `attackFlow` (and its helper `attackDeliverProof`) and any `AttackKind/AttackRes`
  imports from `../types`.
- Delete those functions and the now-unused type imports. Do NOT touch the other
  flows (create/accept/deliver/fly/prove/pod/audit/verify).

**Verify**:
- `grep -rn "attack\|Attack" dashboard/lib/server` → no matches.
- `cd dashboard && bun run lint` → exit 0 (no unused-import errors).

### Step 4: Remove the attacker role from the UI (pre-rename edits)

`dashboard/components/demo/config.ts`: delete the attacker entry in `ROLES`
(lines 70-75), leaving merchant/carrier/recipient/auditor.

`dashboard/components/demo/RoleSwitcher.tsx`:
- Delete `const isAttacker = …` (line 27) and the `accent` line (28); use
  `const accent = "var(--mint)";`.
- Simplify the active style (lines 37-43) to always use `color: "var(--on-mint)"`.
- Fix the hint color (line 62) to always `"var(--mint)"`.
- Update the doc comment (lines 3-7) to drop "Attacker" and "freely" — say
  switching is gated (plan 003 adds the gate; for now keep it simple, no attacker
  mention).

`dashboard/components/demo/RolePanels.tsx`:
- Delete the `ATTACKS` array (lines 746-752) and the entire `AttackerPanel`
  function (lines 754-852) and its section comment (line 744).
- Remove the `case "attacker":` arm (lines 866-867) from `ActionPanel`.
- Remove the `AttackKind, AttackRes` imports (lines 18-19).
- Keep `MerchantPanel`, `CarrierPanel`, `RecipientPanel`, `AuditorPanel` and all
  shared helpers untouched.

`dashboard/components/demo/LoginScreen.tsx`: edit `BEATS[0].body` (line 16) to
drop "and attacker" — e.g. "Switch between merchant, carrier, recipient and
auditor — you drive the entire lifecycle."

**Verify**: `grep -rin "attack" dashboard/components/demo` → no matches.

### Step 5: Guard the persisted role against the removed value

`dashboard/lib/session-context.tsx`, the mount rehydration (lines 79-88):
replace the unchecked cast with a validation so an orphaned `"attacker"` (or any
junk) falls back to the default. Add a module-level constant and use it:

```ts
const VALID_ROLES: readonly Role[] = ["merchant", "carrier", "recipient", "auditor"];
// …inside the mount effect:
const r = window.localStorage.getItem(ROLE_KEY);
if (r && (VALID_ROLES as readonly string[]).includes(r)) setRoleState(r as Role);
```

**Verify**: `grep -n "as Role | null" dashboard/lib/session-context.tsx` → no
matches; `grep -n "VALID_ROLES" dashboard/lib/session-context.tsx` → present.

### Step 6: De-"demo" the landing page

`dashboard/app/page.tsx` (lines 51-87):
- Change `<Link href="/demo" …>` (line 54) → `href="/console"`.
- Eyebrow (line 69): "Interactive demo console" → "The app" (or "Console").
- Copy (lines 74-77): drop "Log in," and "and attacker"; e.g. "Connect your
  wallet, act as merchant, carrier, recipient or auditor, and watch every proof
  settle live on testnet."
- Button (line 83): "Launch demo console →" → "Open the app →" (or "Open console →").
- The section comment (line 51) "the interactive demo console" → "the app".

**Verify**: `grep -in "demo" dashboard/app/page.tsx` → no matches.

### Step 7: Rename the directories

From `dashboard/`:
```
git mv app/demo app/console
git mv components/demo components/console
```
Then update every import path `@/components/demo/` → `@/components/console/`
across the dashboard (they resolve via the `@/*` tsconfig alias):
```
grep -rln "@/components/demo/" dashboard/app dashboard/components dashboard/lib
# edit each hit: replace "@/components/demo/" with "@/components/console/"
```
Also update any relative `./` imports that broke (the rename keeps intra-dir
relative imports valid, so only cross-dir `@/components/demo/...` references need
changing) and the header comment in `lib/types.ts` (line 2 references `app/demo/**`).

Update `dashboard/app/console/layout.tsx` metadata title if it says "Demo".

**Verify**:
- `grep -rn "components/demo\|app/demo\|/demo" dashboard/app dashboard/components dashboard/lib`
  → no matches (the route is now `/console`; the landing links to `/console`).
- `cd dashboard && bun run build` → exit 0, and the route list shows `○ /console`
  (not `/demo`).

### Step 8: README

`dashboard/README.md`: remove the "**Attacker role** …" bullet (line 54) and any
"demo console" phrasing; describe it as the app. (Root `README.md` line ~ may
also mention attacker — grep and fix if present.)

**Verify**: `grep -rin "attacker\|demo console" dashboard/README.md` → no matches.

### Step 8b: Fix the nav CTA + stale comment (required for the rename)

- `dashboard/components/Nav.tsx:9` — `const cta = { href: "/demo", label: "Demo console" }`
  → `href: "/console", label: "Console"`.
- `dashboard/app/providers.tsx` — reword the comment that references
  `app/demo/page.tsx` to `app/console/page.tsx`.

**Verify**: `grep -rn "\"/demo\"\|href=\"/demo\"" dashboard/components dashboard/app`
→ no matches.

### Step 9: Full gate (targeted, satisfiable acceptance)

The greps are targeted at the ACTUAL surfaces being removed (the attacker
role/type/route; the demo-console framing + `/demo` route), and exclude vendored
prover code and ordinary English — a blanket "no attack/demo substring" is
neither satisfiable (vendored `prover-dist`) nor meaningful.

**Verify**:
- `cd dashboard && bun run lint` → exit 0.
- `cd dashboard && bun run build` → exit 0; the route list shows `○ /console`,
  not `/demo`.
- Attacker surface gone (`--exclude-dir=prover-dist` skips vendored crypto):
  `grep -rniE "attacker|AttackKind|AttackReq|AttackRes|api\.attack|AttackerPanel|/api/attack" dashboard/app dashboard/components dashboard/lib --exclude-dir=prover-dist`
  → no matches.
- Demo-console framing + `/demo` route gone:
  `grep -rniE "demo console|/demo\b|app/demo|components/demo" dashboard/app dashboard/components dashboard/lib --exclude-dir=prover-dist`
  → no matches.
- The `demoFadeUp` CSS keyframe (defined in `app/console/page.tsx`, consumed by
  `Console.tsx`, `LoginScreen.tsx`, `toast.tsx`) does NOT match the greps above,
  so it may stay as-is. (Optional: rename to `fadeUp` across those 4 files for
  tidiness — not required.)

## Test plan

There is no test runner in the dashboard (confirmed: `package.json` has no test
script). The gates are the type-check/lint/build and the greps above. Concretely:

- `bun run build` must pass with the route now at `/console`.
- The four greps in Step 9 must be clean (no `attack`, no stray `demo`).
- Manual smoke (optional, if a wallet is available): `bun run dev`, open
  `/console`, connect, confirm the role switcher shows exactly four roles and no
  Attacker tab, and each of the four panels renders.

## Done criteria

ALL must hold:

- [ ] `cd dashboard && bun run lint` exits 0.
- [ ] `cd dashboard && bun run build` exits 0; route list contains `/console`, not `/demo`.
- [ ] `grep -rniE "attacker|AttackKind|AttackReq|AttackRes|api\.attack|AttackerPanel|/api/attack" dashboard/app dashboard/components dashboard/lib --exclude-dir=prover-dist`
      → no matches.
- [ ] `grep -rniE "demo console|/demo\b|app/demo|components/demo" dashboard/app dashboard/components dashboard/lib --exclude-dir=prover-dist`
      → no matches.
- [ ] `dashboard/app/api/attack/` does not exist; `dashboard/lib/server/flows.ts`
      has no `attackFlow`/`attackDeliverProof`/`applyAttack`.
- [ ] `Role` union in `lib/types.ts` has exactly four members.
- [ ] Only in-scope files modified (`git status`) — no edits to
      `dashboard/lib/server/prover-dist/**`.
- [ ] `plans/README.md` status row for 002 updated (reviewer maintains it).

## STOP conditions

Stop and report if:

- The drift check shows the dashboard changed since `d65bd16` and the excerpts no
  longer match.
- The build fails after the rename with an unresolved `@/components/demo/...`
  import you cannot locate — report the failing import list.
- Removing `attackFlow` from `lib/server/flows.ts` reveals it shares a helper
  with a non-attacker flow (it should not — `attackDeliverProof` is
  attacker-only) — if a shared helper would become unused, report before deleting.
- You find `attack`/`demo` references in files outside the in-scope list.

## Maintenance notes

- The route is now `/console`. Any external links, the demo-script doc
  (`docs/demo-script.md`), and the BUIDL/README that point at `/demo` should be
  updated (out of scope here; note them for the owner).
- Plan 003 adds the first-connect role-selection modal and the switch gating on
  top of the renamed `components/console/` structure — keep component names
  stable so 003's excerpts still resolve.
- Recipient PoD is server-signed and confidential-create is intentionally gated
  with an error — these are honest limitations, not "fake data"; do not try to
  "fix" them in this plan.
