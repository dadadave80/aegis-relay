# Aegis Relay Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-player Aegis Relay demo into a believable multi-sided marketplace — carriers discover + claim jobs (credential-gated), real recipients confirm delivery via a claim link with in-browser proof-of-delivery — on a shared KV store, over the existing testnet contracts + ZK core.

**Architecture:** Extend the existing Next.js dashboard. Swap the in-memory mailbox for a serverless KV adapter behind the *same* `store.ts` interface; add a `/market` discovery board, a `/claim/[id]` recipient page (in-browser EdDSA-Poseidon PoD signing), credential-gated packet claim, reputation, carrier onboarding, poll notifications, and a thin refund/report surface. No contract changes.

**Tech Stack:** Next.js 16 (webpack build) · bun workspace · `@vercel/kv` (with an in-memory fallback) · circomlibjs (browser EdDSA-Poseidon) · snarkjs browser Groth16 (already wired) · Stellar Wallets Kit · the deployed registry + credentials contracts.

## Global Constraints

Every task's requirements implicitly include this section.

- **Spec:** `docs/superpowers/specs/2026-07-03-marketplace-design.md` — read it before starting.
- **No contract changes.** Reuse the deployed registry `CAROLAUWCNZGSLSAISY5OVY5GZDZ6ULPBAO3U4FKTU3OIAOVPO6ZKPZL` and credentials `CBEDJCSBU3IKHW34HAZPL55CFJ5AZOTBJUGFXR5TS5JMRJN7W37K4FQF`.
- **Module boundaries:** server-only modules start with `import "server-only";`; client modules start with `"use client";`. **Exception:** `lib/server/kv.ts` omits `server-only` (it is unit-tested via `bun test`, which throws on that import); its server boundary is enforced by its only importer, `store.ts`. `@vercel/kv` is loaded **lazily** so the memory fallback + `bun test` never resolve it and it never reaches the client bundle.
- **Test files** (`**/*.test.ts`) are excluded from `tsc` / `next build` (Task 1 adds the `tsconfig.json` exclude); `bun test` runs them separately.
- **The KV-backed store is fully ASYNC (Task 2)** — this overrides any per-task note that calls a `store.*` method "sync". Every `store.*` call (existing `flows.ts` call sites *and* every task's code snippet) must be `await`ed, and any calling function that isn't already `async` must be made `async`. The `tsc` gate catches a missed await (a `Promise<ShipRecord>` has no `.packet`), so treat a "property does not exist on Promise" error as a forgotten `await`.
- **Per-task verification gates:**
  - Pure logic (KV adapter, listing/claim shapes, PoD signing, reputation math): a `bun:test` file — `cd dashboard && bun test <file>` — real TDD, **failing test first**.
  - Routes / flows / UI: `cd dashboard && bunx tsc --noEmit` + `bun run lint` + `bun run build` (all exit 0), plus a runtime check (curl the route, or `bun run start -- -p <port>` then curl/render — the workspace hoists the `next` bin to the repo root, so `node_modules/.bin/next` inside `dashboard/` does **not** exist).
  - **Commit** at the end of each task with a conventional message.
- **Never throw to the client:** flows return the `{ ok, error?, data? }` `ActionResult` envelope; `ok`/`fail` come from `@/lib/server/flows`. API routes are `export const runtime = "nodejs"; export const dynamic = "force-dynamic";` then a handler returning `NextResponse.json(ok(...))` / `fail(e)`.
- **Reuse `components/ds/*`** for new UI (Stamp, Button, ChainDatum, StatusRail, Honesty, …) with CSS-var styling (`var(--seal)`, `var(--ink)`, …).
- **Claim link** is `/claim/<id>#<seedHex>` — the seed lives in the URL fragment (never sent to the server); the server stores only the `ClaimContext`. The recipient signs the PoD **in the browser**; the server never holds the claim seed at delivery.
- **End-to-end (real credentialed accept → deliver → settle on testnet) needs a funded Freighter wallet** — the one gate not verifiable headless; run once after the plan lands.

---

### Task 1: KV adapter (lib/server/kv.ts)

Thin Redis-ish key/value adapter with a `@vercel/kv`-or-memory fallback. This is the leaf module the store task (and everything above it) consumes. Pure logic → TDD via `bun test` on the memory path.

**Files:**
- `dashboard/lib/server/kv.ts` — new. Exports `interface Kv` and `const kv: Kv`.
- `dashboard/lib/server/kv.test.ts` — new. `bun:test` round-trips for the memory backend.
- `dashboard/package.json` — add `@vercel/kv` dependency (+ `bun.lock` updated by `bun add`).
- `dashboard/tsconfig.json` — exclude `**/*.test.ts` so `bunx tsc --noEmit` / `next build` never choke on `bun:test` (unblocks every downstream task that adds a test file).

**Interfaces:**
- Consumes: nothing (leaf module). Runtime env (optional): `KV_REST_API_URL`, `KV_REST_API_TOKEN` — when both are set, uses `@vercel/kv`; otherwise an in-process `Map` fallback.
- Produces (consumed by the store task):
  ```ts
  export interface Kv {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, val: unknown): Promise<void>;
    del(key: string): Promise<void>;
    sadd(key: string, member: string): Promise<void>;
    srem(key: string, member: string): Promise<void>;
    smembers(key: string): Promise<string[]>;
    zadd(key: string, score: number, member: string): Promise<void>;
    zrange(key: string, start: number, stop: number): Promise<string[]>;
  }
  export const kv: Kv;
  ```
  Semantics mirror Redis: `zrange` is ascending by score (ties broken lexicographically by member) and supports negative indices (`zrange(key, 0, -1)` = all). All values are JSON-serializable; `get` returns `undefined` for a missing key.

- [ ] **Step 1: Write the failing test (RED).** Create `dashboard/lib/server/kv.test.ts` with:
  ```ts
  import { test, expect } from "bun:test";
  import { kv } from "./kv";

  // No KV_REST_API_URL/TOKEN in the test env → `kv` is the in-memory backend.
  // Module-scope maps persist across tests in this file, so each test uses
  // its own key namespace.

  test("get/set/del round-trips a JSON value; missing key is undefined", async () => {
    const key = "t:doc:1";
    expect(await kv.get(key)).toBeUndefined();
    await kv.set(key, { a: 1, b: ["x", "y"], c: null });
    expect(await kv.get(key)).toEqual({ a: 1, b: ["x", "y"], c: null });
    await kv.del(key);
    expect(await kv.get(key)).toBeUndefined();
  });

  test("sadd/srem/smembers behave as a string set (dedupe + remove)", async () => {
    const key = "t:set:1";
    expect(await kv.smembers(key)).toEqual([]);
    await kv.sadd(key, "42");
    await kv.sadd(key, "7");
    await kv.sadd(key, "42"); // duplicate → no-op
    expect([...(await kv.smembers(key))].sort()).toEqual(["42", "7"]);
    await kv.srem(key, "42");
    expect(await kv.smembers(key)).toEqual(["7"]);
  });

  test("zadd/zrange orders by score then member and honors negative indices", async () => {
    const key = "t:zset:1";
    expect(await kv.zrange(key, 0, -1)).toEqual([]);
    await kv.zadd(key, 300, "c");
    await kv.zadd(key, 100, "a");
    await kv.zadd(key, 200, "b");
    await kv.zadd(key, 100, "a2"); // tie on score 100 → lexicographic: a < a2
    expect(await kv.zrange(key, 0, -1)).toEqual(["a", "a2", "b", "c"]);
    expect(await kv.zrange(key, 0, 1)).toEqual(["a", "a2"]);
    expect(await kv.zrange(key, -2, -1)).toEqual(["b", "c"]);
    await kv.zadd(key, 50, "a"); // re-add updates score → sorts first
    expect(await kv.zrange(key, 0, 0)).toEqual(["a"]);
  });
  ```

- [ ] **Step 2: Confirm RED.** Run:
  ```
  cd dashboard && bun test lib/server/kv.test.ts
  ```
  Expected: the run fails because the module under test does not exist yet — output contains `error: Cannot find module './kv'` and ends with `0 pass` / `1 fail`.

- [ ] **Step 3: Implement the adapter (make it GREEN).** Create `dashboard/lib/server/kv.ts`:
  ```ts
  /**
   * dashboard/lib/server/kv.ts — thin KV adapter behind a Redis-ish interface.
   *
   * Backed by @vercel/kv when KV_REST_API_URL + KV_REST_API_TOKEN are present
   * (Vercel KV / Upstash); otherwise an in-process Map fallback so `bun run dev`
   * and `bun test` work with no KV configured. All values are JSON-serializable.
   *
   * NOTE: intentionally NO `import "server-only"` here — this module is unit-
   * tested directly via `bun test`, which is not a React Server environment and
   * would throw on that import. The server boundary is enforced by its only
   * importer, lib/server/store.ts (which IS server-only). @vercel/kv is loaded
   * lazily (dynamic import inside a guarded path), so the memory path never
   * resolves it and it never reaches the client bundle.
   */

  export interface Kv {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, val: unknown): Promise<void>;
    del(key: string): Promise<void>;
    sadd(key: string, member: string): Promise<void>;
    srem(key: string, member: string): Promise<void>;
    smembers(key: string): Promise<string[]>;
    zadd(key: string, score: number, member: string): Promise<void>;
    zrange(key: string, start: number, stop: number): Promise<string[]>;
  }

  function useVercelKv(): boolean {
    return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  }

  // ── In-memory backend (module-scope; source of truth for dev + tests) ────────

  function makeMemoryKv(): Kv {
    const strings = new Map<string, string>(); // JSON blobs
    const sets = new Map<string, Set<string>>();
    const zsets = new Map<string, Map<string, number>>(); // member -> score

    const sortedMembers = (key: string): string[] => {
      const z = zsets.get(key);
      if (!z) return [];
      return [...z.entries()]
        .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([m]) => m);
    };

    return {
      async get<T>(key: string): Promise<T | undefined> {
        const raw = strings.get(key);
        return raw === undefined ? undefined : (JSON.parse(raw) as T);
      },
      async set(key: string, val: unknown): Promise<void> {
        strings.set(key, JSON.stringify(val));
      },
      async del(key: string): Promise<void> {
        strings.delete(key);
        sets.delete(key);
        zsets.delete(key);
      },
      async sadd(key: string, member: string): Promise<void> {
        let s = sets.get(key);
        if (!s) sets.set(key, (s = new Set<string>()));
        s.add(String(member));
      },
      async srem(key: string, member: string): Promise<void> {
        sets.get(key)?.delete(String(member));
      },
      async smembers(key: string): Promise<string[]> {
        return [...(sets.get(key) ?? new Set<string>())];
      },
      async zadd(key: string, score: number, member: string): Promise<void> {
        let z = zsets.get(key);
        if (!z) zsets.set(key, (z = new Map<string, number>()));
        z.set(String(member), score);
      },
      async zrange(key: string, start: number, stop: number): Promise<string[]> {
        const members = sortedMembers(key);
        const n = members.length;
        if (n === 0) return [];
        const s = start < 0 ? Math.max(n + start, 0) : start;
        const e = stop < 0 ? n + stop : Math.min(stop, n - 1);
        if (s > e || s >= n) return [];
        return members.slice(s, e + 1);
      },
    };
  }

  // ── @vercel/kv backend (lazy — only loaded when env is configured) ───────────

  type VercelKvClient = {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<unknown>;
    del(...keys: string[]): Promise<number>;
    sadd(key: string, ...members: (string | number)[]): Promise<number>;
    srem(key: string, ...members: (string | number)[]): Promise<number>;
    smembers(key: string): Promise<unknown[]>;
    zadd(
      key: string,
      ...members: { score: number; member: string }[]
    ): Promise<number | null>;
    zrange(key: string, start: number, stop: number): Promise<unknown[]>;
  };

  let clientPromise: Promise<VercelKvClient> | null = null;
  async function client(): Promise<VercelKvClient> {
    if (!clientPromise) {
      clientPromise = import("@vercel/kv").then(
        (m) => m.kv as unknown as VercelKvClient,
      );
    }
    return clientPromise;
  }

  function makeVercelKv(): Kv {
    return {
      async get<T>(key: string): Promise<T | undefined> {
        const v = await (await client()).get<T>(key);
        return v === null ? undefined : v;
      },
      async set(key: string, val: unknown): Promise<void> {
        await (await client()).set(key, val);
      },
      async del(key: string): Promise<void> {
        await (await client()).del(key);
      },
      async sadd(key: string, member: string): Promise<void> {
        await (await client()).sadd(key, String(member));
      },
      async srem(key: string, member: string): Promise<void> {
        await (await client()).srem(key, String(member));
      },
      // Upstash may auto-parse numeric-looking members (e.g. "42" -> 42); the Kv
      // contract is string[], so coerce on the way out.
      async smembers(key: string): Promise<string[]> {
        return (await (await client()).smembers(key)).map(String);
      },
      async zadd(key: string, score: number, member: string): Promise<void> {
        await (await client()).zadd(key, { score, member: String(member) });
      },
      async zrange(key: string, start: number, stop: number): Promise<string[]> {
        return (await (await client()).zrange(key, start, stop)).map(String);
      },
    };
  }

  export const kv: Kv = useVercelKv() ? makeVercelKv() : makeMemoryKv();
  ```

- [ ] **Step 4: Confirm GREEN.** Run:
  ```
  cd dashboard && bun test lib/server/kv.test.ts
  ```
  Expected: all pass — output ends with `3 pass` / `0 fail` and `Ran 3 tests across 1 file.` (The dynamic `import("@vercel/kv")` is never executed in the memory path, so the not-yet-installed package does not matter here.)

- [ ] **Step 5: Add the `@vercel/kv` dependency.** Run:
  ```
  cd dashboard && bun add @vercel/kv
  ```
  Expected: bun installs it and prints something like `installed @vercel/kv@3.x.x`; `dashboard/package.json` `dependencies` now lists `"@vercel/kv"` and `bun.lock` is updated. Re-run `cd dashboard && bun test lib/server/kv.test.ts` to confirm the tests still show `3 pass`.

- [ ] **Step 6: Keep the toolchain green for test files.** The project tsconfig includes `**/*.ts`, so a `*.test.ts` importing `bun:test` would break `bunx tsc --noEmit` and `next build`. Exclude test files. Edit `dashboard/tsconfig.json`:
  ```
  Replace:   "exclude": ["node_modules"]
  With:      "exclude": ["node_modules", "**/*.test.ts"]
  ```
  Then verify the typecheck is clean with `@vercel/kv` now resolvable:
  ```
  cd dashboard && bunx tsc --noEmit ; echo "EXIT:$?"
  ```
  Expected: no diagnostics, `EXIT:0`.

- [ ] **Step 7: Commit.** Run:
  ```
  cd dashboard && git add lib/server/kv.ts lib/server/kv.test.ts package.json bun.lock tsconfig.json && git commit -m "feat(market): KV adapter with @vercel/kv-or-memory fallback

  Thin Redis-ish kv (get/set/del/sadd/srem/smembers/zadd/zrange) backed by
  @vercel/kv when KV_REST_API_URL/TOKEN are set, else an in-process Map for
  dev + tests. Memory path covered by bun:test. Excludes *.test.ts from tsc so
  bun:test imports don't break the typecheck/build gates."
  ```
  Expected: one commit created (5 files changed). If `bun.lock` lives at the repo root instead of `dashboard/`, `git add` its actual path (run `git status` to confirm) before committing.


### Task 2: Store → KV backing (lib/server/store.ts)

Re-back the mailbox on the Task-1 `kv` adapter, keeping every existing public function's name/params while making them **async** (they now `await` KV round-trips). Add the marketplace accessors (listings + open index, claim contexts, carrier credential status, reputation). Update the only consumer — `flows.ts` — to `await` its `store.*` calls. TDD the ship/pending/listing/rep/carrier/claim round-trips against the memory fallback via `bun test`.

**Files:**
- `dashboard/lib/types.ts` (add 4 store-domain types)
- `dashboard/lib/server/store.ts` (rewrite: kv-backed, async, + new accessors)
- `dashboard/lib/server/store.test.ts` (new, `bun:test`)
- `dashboard/lib/server/flows.ts` (add `await` to the 25 `store.*` call sites)
- `dashboard/tsconfig.json` (exclude `**/*.test.ts` from the tsc gate)

**Interfaces:**
- Consumes: `kv` from `lib/server/kv.ts` (Task 1) — `get<T>(key)`, `set(key,val)`, `del(key)`, `sadd(key,member)`, `srem(key,member)`, `smembers(key)`, `zadd(key,score,member)`, `zrange(key,start,stop)`; all async, JSON values, memory-Map fallback when `KV_REST_API_URL/TOKEN` are unset.
- Produces (all now `Promise`-returning; existing names/params preserved):
  - `putShip(rec: ShipRecord): Promise<void>`, `getShip(id: string|number): Promise<ShipRecord|undefined>`, `updateShip(id: string|number, patch: Partial<ShipRecord>): Promise<ShipRecord|undefined>`, `listShipIds(): Promise<string[]>`
  - `putPending(p: PendingBuild): Promise<void>`, `getPending(buildId: string): Promise<PendingBuild|undefined>`, `delPending(buildId: string): Promise<void>`
  - `putListing(l: Listing): Promise<void>`, `getListing(id: string|number): Promise<Listing|undefined>`, `addOpenListing(id: string|number, createdAt: number): Promise<void>`, `removeOpenListing(id: string|number): Promise<void>`, `listOpenListings(): Promise<string[]>`
  - `putClaimContext(token: string, ctx: ClaimContext): Promise<void>`, `getClaimContext(token: string): Promise<ClaimContext|undefined>`
  - `getCarrier(address: string): Promise<CarrierStatus>`, `setCarrierCredentialed(address: string, at: number): Promise<void>`
  - `getRep(address: string): Promise<Reputation>`, `bumpRep(address: string, kind: "delivered"|"expired"): Promise<Reputation>`
  - Re-exports the record types `CarrierBJJ`, `ProofBundle`, `ShipMeta`, `ShipRecord`, `PendingBuild` unchanged (flows.ts imports `CarrierBJJ`, `ShipMeta`).

> **Cross-task prerequisites (Task 1 must be merged first):** `lib/server/kv.ts` exists, exports `kv` with the 8 methods above, works in the memory-fallback path **without** `@vercel/kv` installed, and only reaches for `@vercel/kv` behind an env guard + a `webpackIgnore`'d dynamic import (so both `bunx tsc --noEmit` and `bun run build` resolve while the package is absent). Task 1's kv adapter's `zrange` returns members ascending by score with `stop = -1` meaning "to end" (Redis/@vercel/kv semantics) — Step 4's `listOpenListings` ordering test asserts exactly this.

---

- [ ] **Step 1: Add the 4 store-domain types to `lib/types.ts`.** These are owned by the store; the route/pod tasks add `MarketClaimReq`/`MarketClaimRes`/`PodSignReq` separately. Append after the `AuditRes` interface (end of file):

  Edit `dashboard/lib/types.ts` — match the tail of `AuditRes`:
  ```ts
  to?: string;
    /** Sender + recipient auditor ciphertexts decrypt to the same amount. */
    channelsAgree?: boolean;
  }
  ```
  replace with:
  ```ts
  to?: string;
    /** Sender + recipient auditor ciphertexts decrypt to the same amount. */
    channelsAgree?: boolean;
  }

  // ── Marketplace (Spec 1): store-domain records ───────────────────────────────

  /** A shipment surfaced on the carrier marketplace. `amount` is null on the
   *  confidential rail (hidden on-chain). Mirrors the on-chain view + mailbox meta. */
  export interface Listing {
    shipmentId: number;
    amount: string | null;
    method: Method;
    laneId: number | null;
    escrowDeadline: number;
    state: ShipmentState;
    createdAt: number;
    payout?: string;
  }

  /** Minimal PoD-signing context handed to a claim recipient. NOT the seed — the
   *  seed lives only in the /claim/<id>#<seedHex> URL fragment, never server-side. */
  export interface ClaimContext {
    shipmentId: number;
    carrierPkCommit: string;
    destRegion: unknown;
    tsWindow: number;
  }

  /** Whether a carrier address has been credentialed (one-shot onboarding). */
  export interface CarrierStatus {
    credentialed: boolean;
    onboardedAt?: number;
  }

  /** Per-address carrier reputation counters. */
  export interface Reputation {
    delivered: number;
    expired: number;
  }
  ```

- [ ] **Step 2 (RED): Write the failing round-trip test.** Create `dashboard/lib/server/store.test.ts`. It stubs `server-only` (which throws on import outside a Server Component graph — bun has no `react-server` resolver condition) via `mock.module`, then dynamically imports `store` so the stub is registered first:

  ```ts
  import { test, expect, beforeAll, mock } from "bun:test";
  import type { ShipRecord, PendingBuild } from "./store";
  import type { Listing, ClaimContext } from "../types";

  // store.ts starts with `import "server-only"`, which throws when evaluated
  // outside a React Server Component graph. Register an empty stub BEFORE the
  // module graph loads, then import store dynamically so the stub wins.
  mock.module("server-only", () => ({}));

  let store: typeof import("./store");
  beforeAll(async () => {
    store = await import("./store");
  });

  test("ship round-trip: put → get (string+number key) → update → listShipIds", async () => {
    const rec = {
      shipmentId: "9001",
      packet: { c_s: "42" },
      meta: { method: "courier", rail: "transparent" },
    } as unknown as ShipRecord;

    await store.putShip(rec);
    expect(await store.getShip("9001")).toEqual(rec);
    expect(await store.getShip(9001)).toEqual(rec); // number key normalizes

    const updated = await store.updateShip("9001", { createdTx: "txabc" });
    expect(updated?.createdTx).toBe("txabc");
    expect((await store.getShip("9001"))?.createdTx).toBe("txabc");
    expect(await store.listShipIds()).toContain("9001");

    expect(await store.updateShip("no-such-ship", {})).toBeUndefined();
    expect(await store.getShip("no-such-ship")).toBeUndefined();
  });

  test("pending round-trip: put → get → del", async () => {
    const p = { buildId: "b1", action: "create", source: "GABC", xdr: "AAAA" } as unknown as PendingBuild;
    await store.putPending(p);
    expect(await store.getPending("b1")).toEqual(p);
    await store.delPending("b1");
    expect(await store.getPending("b1")).toBeUndefined();
  });

  test("listing round-trip + open index: created-order + removal", async () => {
    const a: Listing = { shipmentId: 1, amount: "25", method: "courier", laneId: null, escrowDeadline: 100, state: "OPEN", createdAt: 10 };
    const b: Listing = { shipmentId: 2, amount: null, method: "drone", laneId: 7, escrowDeadline: 200, state: "OPEN", createdAt: 20 };
    await store.putListing(a);
    await store.putListing(b);
    expect(await store.getListing(1)).toEqual(a);
    expect(await store.getListing("2")).toEqual(b);
    expect(await store.getListing(999)).toBeUndefined();

    // add out of order; listOpenListings must return ascending by createdAt score
    await store.addOpenListing(2, b.createdAt);
    await store.addOpenListing(1, a.createdAt);
    expect(await store.listOpenListings()).toEqual(["1", "2"]);

    // srem-backed membership: removed id disappears even though the z-index is append-only
    await store.removeOpenListing(1);
    expect(await store.listOpenListings()).toEqual(["2"]);
  });

  test("reputation + carrier round-trip (defaults + bumps)", async () => {
    const addr = "GCARRIER1";
    expect(await store.getRep(addr)).toEqual({ delivered: 0, expired: 0 });
    await store.bumpRep(addr, "delivered");
    await store.bumpRep(addr, "delivered");
    expect(await store.bumpRep(addr, "expired")).toEqual({ delivered: 2, expired: 1 });
    expect(await store.getRep(addr)).toEqual({ delivered: 2, expired: 1 });

    expect(await store.getCarrier(addr)).toEqual({ credentialed: false });
    await store.setCarrierCredentialed(addr, 1720000000);
    expect(await store.getCarrier(addr)).toEqual({ credentialed: true, onboardedAt: 1720000000 });
  });

  test("claim context round-trip (seed never stored here)", async () => {
    const ctx: ClaimContext = { shipmentId: 7, carrierPkCommit: "99", destRegion: { cell: "abc" }, tsWindow: 3600 };
    await store.putClaimContext("tok_123", ctx);
    expect(await store.getClaimContext("tok_123")).toEqual(ctx);
    expect(await store.getClaimContext("missing")).toBeUndefined();
  });
  ```

  Run it against the **current** (sync, fs-backed) store to confirm RED:
  ```
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun test lib/server/store.test.ts
  ```
  Expected: RED — the new accessors don't exist yet, e.g. `TypeError: store.putListing is not a function` / `store.getRep is not a function`, and a non-zero exit with failing tests (`# fail` > 0). This proves the test exercises the new surface.

- [ ] **Step 3 (GREEN): Rewrite `lib/server/store.ts` on the kv adapter.** Replace the whole file:

  ```ts
  /**
   * dashboard/lib/server/store.ts — the demo "mailbox", re-backed on the KV
   * adapter (lib/server/kv.ts). Every accessor delegates to `kv`; the in-memory
   * Map fallback (dev / no KV env) lives in kv.ts, so this module holds NO local
   * state and NO fs. All accessors are async.
   *
   * Carries a shipment through its lifecycle (off-chain packet, per-shipment
   * carrier Baby Jubjub key, recipient PoD, Groth16 proofs, confidential escrow
   * packet) plus the prepared-but-unsigned tx cache, and the marketplace indices
   * (open listings, claim contexts, carrier credential status, reputation).
   *
   * SECURITY: values here include secrets (recipient claim seed, carrier BJJ seed,
   * E's Stellar secret). KV is a private backing store; secrets are NEVER returned
   * to the client — the routes hand back only sanitized views. ZERO Stellar keys
   * are minted here.
   */

  import "server-only";
  import { kv } from "./kv";
  import type { Packet } from "./prover-dist/lib/packet.js";
  import type { Pod } from "./prover-dist/recipient.js";
  import type { SnarkjsProof } from "./prover-dist/lib/bn254.js";
  import type {
    Method,
    Rail,
    EscrowRecord,
    Listing,
    ClaimContext,
    CarrierStatus,
    Reputation,
  } from "../types";

  // ── Records (shapes unchanged; flows.ts imports CarrierBJJ + ShipMeta) ────────

  /** Per-shipment carrier signing key. `seedHex` is secret — never leaves here. */
  export interface CarrierBJJ {
    seedHex: string;
    pkX: string;
    pkY: string;
    pkBlind: string;
    commit: string; // carrier_pk_commit (decimal)
  }

  export interface ProofBundle {
    proof: SnarkjsProof;
    publicSignals: string[];
  }

  export interface ShipMeta {
    method: Method;
    rail: Rail;
    laneId: number | null;
    fromLat: number;
    fromLon: number;
    toLat: number;
    toLon: number;
    amountXlm: number;
    amountStroops: string;
    escrowDeadline: string;
  }

  export interface ShipRecord {
    shipmentId: string;
    packet: Packet;
    meta: ShipMeta;
    carrierBJJ?: CarrierBJJ;
    pod?: Pod;
    deliveryProof?: ProofBundle;
    flightProof?: ProofBundle;
    /** Confidential rail: E's packet (secret + Grumpkin + opening). Never returned
     * to clients except to the settling wallet (E's key is a hook-caged capability). */
    escrow?: EscrowRecord;
    createdTx?: string;
    acceptTx?: string;
    flightTx?: string;
    deliverTx?: string;
    settleTx?: string;
  }

  /** A prepared-but-unsigned transaction awaiting the wallet's signature. */
  export interface PendingBuild {
    buildId: string;
    action: string;
    source: string;
    xdr: string;
    shipmentId?: string; // for accept/submitFlight/deliver/refund
    // create-only payload, promoted to a ShipRecord once the id is assigned:
    packet?: Packet;
    meta?: ShipMeta;
    escrow?: EscrowRecord; // confidential create only
    // accept-only payload, attached to the ShipRecord on submit:
    carrierBJJ?: CarrierBJJ;
  }

  // ── key helpers ───────────────────────────────────────────────────────────────

  const SHIP = (id: string | number) => `ship:${id}`;
  const SHIP_IDS = "ship:ids";
  const PENDING = (buildId: string) => `pending:${buildId}`;
  const LISTING = (id: string | number) => `listing:${id}`;
  const OPEN_SET = "listings:open"; // authoritative membership (removable via srem)
  const OPEN_Z = "listings:open:z"; // append-only created-order index (zadd; no zrem)
  const CLAIM = (token: string) => `claim:${token}`;
  const CARRIER = (address: string) => `carrier:${address}`;
  const REP = (address: string) => `rep:${address}`;

  // ── Ships ──────────────────────────────────────────────────────────────────────

  export async function putShip(rec: ShipRecord): Promise<void> {
    await kv.set(SHIP(rec.shipmentId), rec);
    await kv.sadd(SHIP_IDS, String(rec.shipmentId));
  }

  export async function getShip(id: string | number): Promise<ShipRecord | undefined> {
    return (await kv.get<ShipRecord>(SHIP(id))) ?? undefined;
  }

  export async function updateShip(
    id: string | number,
    patch: Partial<ShipRecord>,
  ): Promise<ShipRecord | undefined> {
    const rec = await getShip(id);
    if (!rec) return undefined;
    const next = { ...rec, ...patch };
    await putShip(next);
    return next;
  }

  /** All known shipment ids, used by the replay attack + marketplace sweeps. */
  export async function listShipIds(): Promise<string[]> {
    return kv.smembers(SHIP_IDS);
  }

  // ── Pending txs ─────────────────────────────────────────────────────────────────

  export async function putPending(p: PendingBuild): Promise<void> {
    await kv.set(PENDING(p.buildId), p);
  }

  export async function getPending(buildId: string): Promise<PendingBuild | undefined> {
    return (await kv.get<PendingBuild>(PENDING(buildId))) ?? undefined;
  }

  export async function delPending(buildId: string): Promise<void> {
    await kv.del(PENDING(buildId));
  }

  // ── Listings + open index ───────────────────────────────────────────────────────

  export async function putListing(l: Listing): Promise<void> {
    await kv.set(LISTING(l.shipmentId), l);
  }

  export async function getListing(id: string | number): Promise<Listing | undefined> {
    return (await kv.get<Listing>(LISTING(id))) ?? undefined;
  }

  /** Track a shipment as an open listing. The set is authoritative membership
   *  (removable via srem); the sorted set carries created-order for the feed. */
  export async function addOpenListing(id: string | number, createdAt: number): Promise<void> {
    await kv.sadd(OPEN_SET, String(id));
    await kv.zadd(OPEN_Z, createdAt, String(id));
  }

  export async function removeOpenListing(id: string | number): Promise<void> {
    await kv.srem(OPEN_SET, String(id));
  }

  /** Open listing ids in createdAt order. The z-index is append-only (no zrem),
   *  so we intersect its order with the authoritative membership set; any live id
   *  missing from the z-index is appended defensively. */
  export async function listOpenListings(): Promise<string[]> {
    const [ordered, live] = await Promise.all([
      kv.zrange(OPEN_Z, 0, -1),
      kv.smembers(OPEN_SET),
    ]);
    const liveSet = new Set(live);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of ordered) {
      if (liveSet.has(id) && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    for (const id of live) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  }

  // ── Claim contexts (seed stays in the URL fragment; never here) ──────────────────

  export async function putClaimContext(token: string, ctx: ClaimContext): Promise<void> {
    await kv.set(CLAIM(token), ctx);
  }

  export async function getClaimContext(token: string): Promise<ClaimContext | undefined> {
    return (await kv.get<ClaimContext>(CLAIM(token))) ?? undefined;
  }

  // ── Carrier credential status ────────────────────────────────────────────────────

  export async function getCarrier(address: string): Promise<CarrierStatus> {
    return (await kv.get<CarrierStatus>(CARRIER(address))) ?? { credentialed: false };
  }

  export async function setCarrierCredentialed(address: string, at: number): Promise<void> {
    const status: CarrierStatus = { credentialed: true, onboardedAt: at };
    await kv.set(CARRIER(address), status);
  }

  // ── Reputation ───────────────────────────────────────────────────────────────────

  export async function getRep(address: string): Promise<Reputation> {
    return (await kv.get<Reputation>(REP(address))) ?? { delivered: 0, expired: 0 };
  }

  export async function bumpRep(
    address: string,
    kind: "delivered" | "expired",
  ): Promise<Reputation> {
    const rep = await getRep(address);
    const next: Reputation = {
      delivered: rep.delivered + (kind === "delivered" ? 1 : 0),
      expired: rep.expired + (kind === "expired" ? 1 : 0),
    };
    await kv.set(REP(address), next);
    return next;
  }
  ```

  Re-run the test — expect GREEN:
  ```
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun test lib/server/store.test.ts
  ```
  Expected: `5 pass`, `0 fail`, exit 0. (If `listOpenListings` returns `["2","1"]`, Task 1's `zrange` isn't score-ascending — fix Task 1, not this test.)

- [ ] **Step 4: Await the `store.*` call sites in `flows.ts`.** All 25 calls sit inside `async` functions, so adding `await` is the only change. Apply six `replace_all` edits to `dashboard/lib/server/flows.ts`:

  1. `store.getShip(` → `await store.getShip(` (8 sites; `if (!await store.getShip(id))` parses as `!(await …)`)
  2. `store.putShip(` → `await store.putShip(` (2 sites)
  3. `store.updateShip(` → `await store.updateShip(` (5 sites)
  4. `store.getPending(` → `await store.getPending(` (1 site)
  5. `store.putPending(` → `await store.putPending(` (6 sites)
  6. `store.delPending(` → `await store.delPending(` (1 site)

  Verify no bare (un-awaited) `store.` calls remain and that no double-await slipped in:
  ```
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && \
    echo "--- bare (should be 0) ---" && grep -nE '(^|[^t] )store\.(getShip|putShip|updateShip|getPending|putPending|delPending)\(' lib/server/flows.ts | grep -v 'await store\.' | grep -v 'import ' || echo "none"; \
    echo "--- double await (should be none) ---" && grep -n 'await await store' lib/server/flows.ts || echo "none"
  ```
  Expected: `none` for both. (`listShipIds` is not called in flows.ts — nothing to change there.)

- [ ] **Step 5: Exclude bun tests from the tsc gate.** `tsconfig.json` `include: ["**/*.ts", …]` would type-check `store.test.ts`, whose `bun:test` import has no ambient types installed. Exclude it (idempotent — skip if Task 1 already added it).

  Edit `dashboard/tsconfig.json`:
  ```json
  "exclude": ["node_modules"]
  ```
  →
  ```json
  "exclude": ["node_modules", "**/*.test.ts"]
  ```

- [ ] **Step 6: Run the type/lint/build gates.**
  ```
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bunx tsc --noEmit && echo "TSC_OK"
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun run lint && echo "LINT_OK"
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun run build && echo "BUILD_OK"
  ```
  Expected: `TSC_OK`, `LINT_OK` (no ESLint warnings or errors), and `BUILD_OK` after `next build --webpack` prints `Compiled successfully`. Each exits 0. (If `tsc`/`build` fail on `Cannot find module '@vercel/kv'`, that's the Task-1 kv.ts guard — see prerequisites — not this task's store code.)

- [ ] **Step 7: Re-run the store test as the runtime check, then commit.** The `bun test` round-trips are the runtime observation of the re-backed store (put/get/update/list against the live memory-fallback `kv`):
  ```
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun test lib/server/store.test.ts && echo "STORE_OK"
  ```
  Expected: `5 pass`, `0 fail`, `STORE_OK`. Then commit:
  ```
  cd /Users/dadadave/Dev/Stellar/aegis-relay && git add dashboard/lib/types.ts dashboard/lib/server/store.ts dashboard/lib/server/store.test.ts dashboard/lib/server/flows.ts dashboard/tsconfig.json && \
    git commit -m "feat(store): re-back mailbox on KV adapter + marketplace accessors

  - store.ts now async, delegating to lib/server/kv (Task 1); drop fs/Map
  - add listing/open-index, claim-context, carrier-status, reputation accessors
  - types.ts: Listing, ClaimContext, CarrierStatus, Reputation
  - flows.ts: await all store.* call sites (functions unchanged otherwise)
  - bun:test round-trips (ship/pending/listing/rep/carrier/claim) on memory fallback"
  ```


### Task 3: Types + listing/claim on create (lib/types.ts, lib/server/flows.ts)

Adds the marketplace types, a pure `buildListing` helper (TDD'd), and wires the listing/claim-link lifecycle into `submitAction`: on **create** publish `listing:<id>` + `openListings` + a seedless `ClaimContext`, and return the recipient claim link `/claim/<id>#<seedHex>`; on **accept** flip the listing to `IN_TRANSIT`, record payout, drop it from the board, and bind the carrier commit into the claim context.

> **Depends on Task 2 (store):** consumes the new async accessors `putListing / getListing / addOpenListing / removeOpenListing / putClaimContext / getClaimContext`. Run Task 3's `tsc`/`build` gates only after Task 2 has landed those, or they will report `Property 'putListing' does not exist on ... store`.

**Files:**
- `dashboard/lib/types.ts` — new marketplace shapes + `SubmitTxRes.claimLink` (edit)
- `dashboard/lib/listing.ts` — pure `buildListing` builder (new)
- `dashboard/lib/listing.test.ts` — `bun:test` for the listing shape (new)
- `dashboard/lib/server/flows.ts` — listing/claim lifecycle in `submitAction` (edit)

**Interfaces:**
- **Consumes** (Task 2 store, all `async`): `putListing(l: Listing): Promise<void>`, `getListing(id: string|number): Promise<Listing|undefined>`, `addOpenListing(id: string, createdAt: number): Promise<void>`, `removeOpenListing(id: string): Promise<void>`, `putClaimContext(token: string, ctx: ClaimContext): Promise<void>`, `getClaimContext(token: string): Promise<ClaimContext|undefined>`. Existing store fns are now async too (`getShip/putShip/updateShip/getPending/delPending` — all return Promises; await them per Global Constraints). Seed already surfaced by `buildShipment` at `packet.recipient_claim.eddsa_seed_hex`.
- **Produces:** `lib/types.ts` → `Listing`, `ClaimContext`, `CarrierStatus`, `Reputation`, `MarketClaimReq`, `MarketClaimRes`, `PodSignReq`, and `SubmitTxRes.claimLink?: string`. `lib/listing.ts` → `buildListing(inp: ListingInput): Listing`. `flows.ts` → listing lifecycle + claim link on the create/accept submit path.
- **Contract note:** the interface contract's "BuildTxRes carrying claimLink" is realized as **`SubmitTxRes.claimLink`** — the link needs the on-chain shipment id, which is assigned only when `create_shipment` returns *during submit* (spec §6.1 "on submit, when the id is assigned"). There is no id at build time. Neighbor UI reads the claim link from the create submit response.

---

- [ ] **Step 1: Add the marketplace types + `claimLink` to `lib/types.ts`.**
  In `/Users/dadadave/Dev/Stellar/aegis-relay/dashboard/lib/types.ts`, change `SubmitTxRes` to add `claimLink`:
  ```ts
  export interface SubmitTxRes {
    tx: string;                         // explorer tx hash / id
    shipmentId?: number;                // assigned on create
    view?: ShipmentView;
    claimLink?: string;                 // create only: /claim/<id>#<seedHex> for the recipient
  }
  ```
  Then append this section to the **end** of the file:
  ```ts
  // ── Marketplace (Spec 1) ─────────────────────────────────────────────────────

  /** Board summary for a shipment — ONLY on-chain-public metadata. `amount` is the
   *  transparent-rail escrow (XLM decimal string); null on the confidential rail
   *  (amount hidden — spec §9). Written on create, state-synced on accept/terminal. */
  export interface Listing {
    shipmentId: number;
    amount: string | null;
    method: Method;
    laneId: number | null;
    escrowDeadline: number;
    state: ShipmentState;
    createdAt: number;
    payout?: string;
  }

  /** Recipient signing context served by the claim link — the MINIMAL disclosure
   *  needed to sign the PoD in-browser. NEVER contains the claim seed (that lives
   *  only in the /claim/<id>#<seed> fragment). `carrierPkCommit` is "" until a
   *  carrier accepts, then bound. */
  export interface ClaimContext {
    shipmentId: number;
    carrierPkCommit: string;
    destRegion: unknown;   // dest-region root only (minimal disclosure; §13)
    tsWindow: number;      // latest admissible PoD ts (unix seconds)
  }

  /** Carrier onboarding/credential status (KV `carrier:<address>`). */
  export interface CarrierStatus {
    credentialed: boolean;
    onboardedAt?: number;
  }

  /** Reputation counters derived from on-chain terminal states (KV `rep:<address>`). */
  export interface Reputation {
    delivered: number;
    expired: number;
  }

  /** POST /api/market — credential-gated packet claim. */
  export interface MarketClaimReq { shipmentId: number; }
  export interface MarketClaimRes { packet: unknown; }

  /** POST /api/claim — recipient stores the in-browser PoD signature. */
  export interface PodSignReq {
    shipmentId: number;
    signature: unknown;
    lat: number;
    lon: number;
  }
  ```
  These match the shared contract exactly (`Method`, `ShipmentState`, `Rail` already exist in this file).

- [ ] **Step 2: Write the failing `bun:test` for the listing shape (TDD red).**
  Create `/Users/dadadave/Dev/Stellar/aegis-relay/dashboard/lib/listing.test.ts`:
  ```ts
  import { test, expect } from "bun:test";
  import { buildListing } from "./listing";

  test("transparent listing exposes the XLM amount and starts OPEN", () => {
    const l = buildListing({
      shipmentId: 42,
      rail: "transparent",
      method: "courier",
      laneId: null,
      amountXlm: 25,
      escrowDeadline: 1_800_000_000,
      createdAt: 1_700_000_000_000,
    });
    expect(l).toEqual({
      shipmentId: 42,
      amount: "25",
      method: "courier",
      laneId: null,
      escrowDeadline: 1_800_000_000,
      state: "OPEN",
      createdAt: 1_700_000_000_000,
    });
  });

  test("confidential listing hides the amount (null)", () => {
    const l = buildListing({
      shipmentId: 7,
      rail: "confidential",
      method: "courier",
      laneId: null,
      amountXlm: 999, // private figure — must NOT surface on the board
      escrowDeadline: 1_800_000_000,
      createdAt: 1_700_000_000_001,
    });
    expect(l.amount).toBeNull();
    expect(l.state).toBe("OPEN");
  });

  test("drone listing carries the lane id; payout omitted until accept", () => {
    const l = buildListing({
      shipmentId: 3,
      rail: "transparent",
      method: "drone",
      laneId: 7,
      amountXlm: 50,
      escrowDeadline: 1_800_000_000,
      createdAt: 1_700_000_000_002,
    });
    expect(l.laneId).toBe(7);
    expect(l.method).toBe("drone");
    expect("payout" in l).toBe(false);
  });

  test("payout is included when provided (accept-time listing)", () => {
    const l = buildListing({
      shipmentId: 9,
      rail: "transparent",
      method: "courier",
      laneId: null,
      amountXlm: 10,
      escrowDeadline: 1_800_000_000,
      createdAt: 1_700_000_000_003,
      state: "IN_TRANSIT",
      payout: "GAAA",
    });
    expect(l.state).toBe("IN_TRANSIT");
    expect(l.payout).toBe("GAAA");
  });
  ```
  Run it and confirm it fails because the module does not exist yet:
  ```
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun test lib/listing.test.ts
  ```
  Expected (red): `error: Cannot find module './listing' from '.../dashboard/lib/listing.test.ts'` and `0 pass`.

- [ ] **Step 3: Create the pure `buildListing` builder (TDD green).**
  Create `/Users/dadadave/Dev/Stellar/aegis-relay/dashboard/lib/listing.ts` — no `"server-only"` and only type imports (erased at runtime), so it is `bun test`-importable and reusable by the `/market` board:
  ```ts
  // dashboard/lib/listing.ts
  // Pure builder for a marketplace board Listing. Deliberately free of any
  // "server-only" / crypto imports so it is unit-testable under `bun test` and
  // reusable by the /market board. The board shows ONLY on-chain-public metadata:
  // the transparent-rail escrow amount is exposed; the confidential-rail amount is
  // hidden (null) — spec §9.

  import type { Listing, Method, Rail, ShipmentState } from "./types";

  export interface ListingInput {
    shipmentId: number;
    rail: Rail;
    method: Method;
    laneId: number | null;
    amountXlm: number;      // merchant's XLM figure; hidden on the confidential rail
    escrowDeadline: number; // unix seconds
    createdAt: number;
    state?: ShipmentState;  // defaults OPEN (create); IN_TRANSIT etc. on sync
    payout?: string;        // bound at accept
  }

  export function buildListing(inp: ListingInput): Listing {
    return {
      shipmentId: inp.shipmentId,
      amount: inp.rail === "confidential" ? null : String(inp.amountXlm),
      method: inp.method,
      laneId: inp.laneId,
      escrowDeadline: inp.escrowDeadline,
      state: inp.state ?? "OPEN",
      createdAt: inp.createdAt,
      ...(inp.payout ? { payout: inp.payout } : {}),
    };
  }
  ```
  Re-run the test:
  ```
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun test lib/listing.test.ts
  ```
  Expected (green): `4 pass`, `0 fail`.

- [ ] **Step 4: Wire the new imports into `flows.ts`.**
  In `/Users/dadadave/Dev/Stellar/aegis-relay/dashboard/lib/server/flows.ts`, add `ClaimContext` to the type import block (append it inside the existing `import type { … } from "../types";`):
  ```ts
  import type {
    BuildTxReq,
    BuildTxRes,
    SubmitTxReq,
    SubmitTxRes,
    CreateParams,
    ShipmentView,
    ShipmentState,
    Method,
    Rail,
    VerifyRes,
    FlyRes,
    AuditRes,
    ConfSettleRelease,
    ClaimContext,
  } from "../types";
  ```
  Then, immediately after that `} from "../types";` line, add the value import for the pure builder:
  ```ts
  import { buildListing } from "../listing";
  ```

- [ ] **Step 5: Wire the listing/claim lifecycle into `submitAction`.**
  In the same file, replace the entire existing `submitAction` function (the `export async function submitAction(...) { … }` block) with this complete version — it adds the create-side listing/claim publication + `claimLink`, and the accept-side board removal + `IN_TRANSIT`/payout sync + carrier-commit binding:
  ```ts
  export async function submitAction(req: SubmitTxReq): Promise<SubmitTxRes> {
    const pend = store.getPending(req.buildId);
    if (!pend) throw new Error(`no pending tx for buildId ${req.buildId}`);
    const res = await submitSignedXdr(req.signedXdr, pend.xdr);

    let shipmentId: number | undefined;
    let claimLink: string | undefined;
    if (pend.action === "create") {
      const idRaw = res.returnValue;
      const id = typeof idRaw === "bigint" ? idRaw.toString() : String(idRaw ?? "");
      if (!id || id === "null") throw new Error("create succeeded but no shipment id in return value");
      shipmentId = Number(id);
      const packet = pend.packet!;
      const meta = pend.meta!;
      packet.shipment_id = id;
      store.putShip({ shipmentId: id, packet, meta, createdTx: res.hash, escrow: pend.escrow });

      // ── Marketplace: publish the OPEN board listing (spec §6.1) ──
      const createdAt = Date.now();
      const listing = buildListing({
        shipmentId,
        rail: meta.rail,
        method: meta.method,
        laneId: meta.laneId,
        amountXlm: meta.amountXlm, // null'd for the confidential rail inside buildListing
        escrowDeadline: Number(meta.escrowDeadline),
        createdAt,
      });
      await store.putListing(listing);
      await store.addOpenListing(id, createdAt);

      // Recipient signing context — deliberately WITHOUT the claim seed. Only the
      // dest-region root is exposed (minimal disclosure, §13; the recipient derives
      // cell_rd from their own confirmed location). carrier_pk_commit is bound at accept.
      const ctx: ClaimContext = {
        shipmentId,
        carrierPkCommit: "",
        destRegion: packet.dest_region.root,
        tsWindow: Number(meta.escrowDeadline),
      };
      await store.putClaimContext(id, ctx);

      // The claim SEED travels ONLY in the link fragment — never sent to or stored by
      // the server (§5 honesty). Surfaced here so the merchant UI can hand the link
      // to the recipient. The id exists only now (create_shipment return value).
      claimLink = `/claim/${id}#${packet.recipient_claim.eddsa_seed_hex}`;
    } else if (pend.action === "accept" && pend.shipmentId) {
      const rec = store.getShip(pend.shipmentId);
      if (rec && pend.carrierBJJ) {
        rec.packet.carrier_pk_commit = pend.carrierBJJ.commit;
        store.putShip({ ...rec, carrierBJJ: pend.carrierBJJ, acceptTx: res.hash });
      }
      shipmentId = Number(pend.shipmentId);

      // ── Marketplace: the shipment leaves the board; listing → IN_TRANSIT + payout ──
      await store.removeOpenListing(pend.shipmentId);
      const listing = await store.getListing(pend.shipmentId);
      if (listing) {
        listing.state = "IN_TRANSIT";
        listing.payout = pend.source; // payout == the connected carrier wallet (buildAccept)
        await store.putListing(listing);
      }
      // Complete the recipient signing context now that a carrier is bound.
      if (pend.carrierBJJ) {
        const ctx = await store.getClaimContext(pend.shipmentId);
        if (ctx) {
          ctx.carrierPkCommit = pend.carrierBJJ.commit;
          await store.putClaimContext(pend.shipmentId, ctx);
        }
      }
    } else if (pend.shipmentId) {
      const patch = pend.action === "submitFlight" ? { flightTx: res.hash } : { deliverTx: res.hash };
      store.updateShip(pend.shipmentId, patch);
      shipmentId = Number(pend.shipmentId);
    }

    store.delPending(req.buildId);
    const view = shipmentId !== undefined ? await shipmentView(shipmentId) : undefined;
    return { tx: res.hash, shipmentId, view, claimLink };
  }
  ```
  (Both the transparent and confidential create paths flow through this one branch, so confidential shipments also appear on the board with `amount: null` and still mint a claim link.)

- [ ] **Step 6: Typecheck + lint.**
  ```
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bunx tsc --noEmit && bun run lint
  ```
  Expected: `tsc` prints nothing (exit 0); lint prints no warnings/errors (exit 0). If `tsc` reports `Property 'putListing' does not exist on typeof import(".../store")`, Task 2's store accessors have not landed yet — merge Task 2 first.

- [ ] **Step 7: Build + boot smoke (runtime gate).**
  ```
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun run build
  ```
  Expected: `✓ Compiled successfully` and the route table, exit 0 (this compiles `flows.ts` into the API-route bundles). Then confirm the built app boots with the new `flows.ts`:
  ```
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard
  (bun run start -- -p 3939 &) ; sleep 4
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3939/
  pkill -f "next start" 2>/dev/null || true
  ```
  Expected: `200` (a live HTTP response ⇒ the built app booted with the new listing/claim wiring). The wallet-signed create→accept submit path is exercised by the post-deploy testnet E2E (spec §11, needs a funded Freighter wallet); the substantive new logic here is covered by the Step 3 unit test.

- [ ] **Step 8: Commit.**
  ```
  cd /Users/dadadave/Dev/Stellar/aegis-relay
  git add dashboard/lib/types.ts dashboard/lib/listing.ts dashboard/lib/listing.test.ts dashboard/lib/server/flows.ts
  git commit -m "feat(market): listing + claim types; listing lifecycle + claim link on create/accept"
  ```
  Expected: one commit with the four files; `git status` clean afterward.


### Task 4: Browser PoD signing (lib/pod/sign-browser.ts)

Implements `signPodBrowser` — the recipient signs the proof-of-delivery message **in the browser** with the Baby Jubjub claim seed that arrived only in the `/claim` URL fragment. Faithful mirror of the server reference `prover-dist/recipient.js` `signPod` (same `DOM_PODMSG=5` tag, same `buildPoseidon`→decimal→`bjF.e(...)` field re-encoding, same `buildEddsa` signer). Parity is proven by a `bun:test` that both pins a golden vector and round-trips through `eddsa.verifyPoseidon`. Produces the `{R8,S}` signature consumed by the `/claim` page (Task 6).

**Files:**
- `dashboard/lib/pod/sign-browser.ts` — new, `"use client"`. Exports `signPodBrowser`, `hexToBytes`, `SignPodBrowserArgs`.
- `dashboard/lib/pod/circomlibjs.d.ts` — new. Minimal ambient shim (circomlibjs ships no types) so `tsc --noEmit` resolves `buildEddsa`/`buildPoseidon`.
- `dashboard/types/bun-test.d.ts` — new **shared** shim so `tsc` resolves `bun:test` in `*.test.ts` (tsconfig `include` is `**/*.ts`). **Create only if a sibling pure-logic task hasn't already added it** (avoid a duplicate `declare module "bun:test"`).
- `dashboard/lib/pod/sign-browser.test.ts` — new `bun:test` (TDD; written first).

**Interfaces:**
- **Produces:** `signPodBrowser(args: { seedHex: string; shipmentId: number; carrierPkCommit: string; cellRd: string; ts: number }): Promise<{ R8: [string, string]; S: string }>` and `hexToBytes(hex: string): Uint8Array`. Message: `m = Poseidon([DOM_PODMSG=5, shipmentId, carrierPkCommit, cellRd, ts])`.
- **Consumes:** `circomlibjs` (`buildEddsa`, `buildPoseidon`) — already a `dashboard` dep. Mirrors `prover-dist/recipient.js` `signPod` + `prover-dist/lib/poseidon.js` `podMsg`.
- **Consumed by:** Task 6 (`/claim/[id]` client page) posts only `{R8,S}` to `market-pod-sign` (`PodSignReq`); the seed never leaves the browser.

> **⚠ Client-bundle flag (for Task 6, discovered here):** `circomlibjs` is currently `serverExternalPackages`-only (`next.config.ts`) and has never been in a **client** graph. Its eddsa internals call the **global `Buffer`** (`Buffer.from(prv)` in `prv2pub`/`signPoseidon`), which the browser lacks. Signing needs **no randomness** (deterministic EdDSA-Poseidon), so the existing `crypto:false` fallback is fine — the **only** missing piece is `Buffer`. When Task 6 imports this module into the `/claim` client page, `bun run build`/runtime will fail with `Buffer is not defined` unless `next.config.ts`'s `webpack(..., {isServer})` block adds, under `if (!isServer)`:
> ```ts
> // circomlibjs (lib/pod/sign-browser) calls the global Buffer in the browser.
> const webpack = require("webpack");
> config.plugins.push(new webpack.ProvidePlugin({ Buffer: ["buffer", "Buffer"] }));
> config.resolve.fallback = { ...config.resolve.fallback, buffer: require.resolve("buffer/") };
> ```
> plus `bun add buffer`. This task does **not** edit `next.config.ts` (Task 6 owns that, since it introduces the client import). Task 4's own gate is the `bun:test` below (the module is not yet in any client graph, so it does not affect the current build).

- [ ] **Step 1: Write the failing test first (TDD red).** Create the dir and the test. Golden vector is locked from the `prover-dist` `signPod` path (verified against the installed `circomlibjs`).

```bash
mkdir -p /Users/dadadave/Dev/Stellar/aegis-relay/dashboard/lib/pod
```

Create `dashboard/lib/pod/sign-browser.test.ts`:
```ts
import { test, expect } from "bun:test";
import { buildEddsa, buildPoseidon } from "circomlibjs";
import { signPodBrowser, hexToBytes } from "./sign-browser";

// Pinned fixture — every value < BN254 scalar field r.
const FIX = {
  seedHex: "01".repeat(32),
  shipmentId: 42,
  carrierPkCommit: "12345678901234567890",
  cellRd: "987654321",
  ts: 1_700_000_000,
} as const;

const DOM_PODMSG = 5n;

// Golden vector: deterministic EdDSA-Poseidon output for FIX, locked from the
// prover-dist recipient.signPod reference path. Proves node/bun/browser parity.
const GOLDEN = {
  R8x: "14096562531871567268486947786239539474187363526868524743791081843279728841793",
  R8y: "4519269772876913247747127903344600168414194767092648667362530706554758514352",
  S: "2212755858311729726135700802042100446201435558261968345478997182793010900987",
} as const;

function podMsgFE(
  poseidon: Awaited<ReturnType<typeof buildPoseidon>>,
  bjF: { e(x: bigint): unknown },
  ts: number,
): unknown {
  const dec = poseidon.F.toString(
    poseidon([
      DOM_PODMSG,
      BigInt(FIX.shipmentId),
      BigInt(FIX.carrierPkCommit),
      BigInt(FIX.cellRd),
      BigInt(ts),
    ]),
  );
  return bjF.e(BigInt(dec));
}

test("hexToBytes decodes a 32-byte seed and tolerates a 0x prefix", () => {
  const b = hexToBytes(FIX.seedHex);
  expect(b).toBeInstanceOf(Uint8Array);
  expect(b.length).toBe(32);
  expect(b[0]).toBe(1);
  expect(hexToBytes("0x" + FIX.seedHex).length).toBe(32);
});

test("signPodBrowser matches the pinned golden vector", async () => {
  const sig = await signPodBrowser(FIX);
  expect(sig.R8[0]).toBe(GOLDEN.R8x);
  expect(sig.R8[1]).toBe(GOLDEN.R8y);
  expect(sig.S).toBe(GOLDEN.S);
});

test("signPodBrowser signature is accepted by eddsa.verifyPoseidon (client parity)", async () => {
  const [eddsa, poseidon] = await Promise.all([buildEddsa(), buildPoseidon()]);
  const bjF = eddsa.babyJub.F;
  const pub = eddsa.prv2pub(hexToBytes(FIX.seedHex));
  const sig = await signPodBrowser(FIX);
  const R8: [unknown, unknown] = [bjF.e(BigInt(sig.R8[0])), bjF.e(BigInt(sig.R8[1]))];
  expect(eddsa.verifyPoseidon(podMsgFE(poseidon, bjF, FIX.ts), { R8, S: BigInt(sig.S) }, pub)).toBe(true);
});

test("verifyPoseidon rejects the signature under a tampered ts", async () => {
  const [eddsa, poseidon] = await Promise.all([buildEddsa(), buildPoseidon()]);
  const bjF = eddsa.babyJub.F;
  const pub = eddsa.prv2pub(hexToBytes(FIX.seedHex));
  const sig = await signPodBrowser(FIX);
  const R8: [unknown, unknown] = [bjF.e(BigInt(sig.R8[0])), bjF.e(BigInt(sig.R8[1]))];
  expect(eddsa.verifyPoseidon(podMsgFE(poseidon, bjF, FIX.ts + 1), { R8, S: BigInt(sig.S) }, pub)).toBe(false);
});
```

- [ ] **Step 2: Run the test — confirm RED.**
```bash
cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun test lib/pod/sign-browser.test.ts
```
Expected: resolution failure (module not yet created), non-zero exit:
```
error: Cannot find module './sign-browser' from '.../dashboard/lib/pod/sign-browser.test.ts'
```

- [ ] **Step 3: Add the shared `bun:test` type shim (only if absent).** Skip if `dashboard/types/bun-test.d.ts` already exists (a sibling pure-logic task may have created it — do not add a second `declare module "bun:test"`).
```bash
mkdir -p /Users/dadadave/Dev/Stellar/aegis-relay/dashboard/types
test -f /Users/dadadave/Dev/Stellar/aegis-relay/dashboard/types/bun-test.d.ts && echo "EXISTS — skip Step 3 file write" || echo "ABSENT — write it"
```
If absent, create `dashboard/types/bun-test.d.ts`:
```ts
// Minimal ambient surface so `tsc --noEmit` resolves the `bun:test` imports in
// *.test.ts (tsconfig `include` is **/*.ts). Bun runs the tests; this only
// satisfies the type-checker. Shared across all pure-logic test tasks.
declare module "bun:test" {
  export const test: (name: string, fn: () => unknown | Promise<unknown>) => void;
  export const expect: (value: unknown) => {
    toBe(v: unknown): void;
    toEqual(v: unknown): void;
    toBeInstanceOf(v: unknown): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toThrow(v?: unknown): void;
  };
}
```

- [ ] **Step 4: Add the circomlibjs ambient shim.** Create `dashboard/lib/pod/circomlibjs.d.ts` (opaque field elements as `unknown` — we only pass them through, never operate on them):
```ts
// circomlibjs ships no types; minimal ambient surface for the PoD signer.
declare module "circomlibjs" {
  type FE = unknown; // opaque babyJub / poseidon field element
  interface F {
    e(x: bigint | number | string): FE;
    toString(x: FE): string;
    toObject(x: FE): bigint;
  }
  interface Poseidon {
    (inputs: Array<bigint | number | string | FE>): FE;
    F: F;
  }
  interface Eddsa {
    poseidon: Poseidon;
    babyJub: { F: F };
    prv2pub(prv: Uint8Array): [FE, FE];
    signPoseidon(prv: Uint8Array, msg: FE): { R8: [FE, FE]; S: bigint };
    verifyPoseidon(msg: FE, sig: { R8: [FE, FE]; S: bigint }, A: [FE, FE]): boolean;
  }
  export function buildEddsa(): Promise<Eddsa>;
  export function buildPoseidon(): Promise<Poseidon>;
}
```

- [ ] **Step 5: Implement `signPodBrowser` (TDD green).** Create `dashboard/lib/pod/sign-browser.ts`:
```ts
"use client";

/**
 * sign-browser.ts — in-browser EdDSA-Poseidon proof-of-delivery signing.
 *
 * The recipient's Baby Jubjub claim seed arrives ONLY in the /claim link URL
 * fragment (#<seedHex>) and never leaves the browser. This module derives the
 * key, signs
 *   m = Poseidon(DOM_PODMSG, shipment_id, carrier_pk_commit, cell_rd, ts)
 * and returns the signature so the /claim page (Task 6) POSTs only {R8, S}.
 *
 * Faithful mirror of prover-dist/recipient.ts `signPod` (the server reference):
 * identical DOM_PODMSG=5 tag, the buildPoseidon → decimal → `bjF.e(BigInt(...))`
 * field re-encoding of prover-dist/lib/poseidon.ts, and the buildEddsa signer.
 * Parity is proven by sign-browser.test.ts (pinned golden vector + verifyPoseidon).
 *
 * circomlibjs is already a dashboard dep and runs isomorphically. NOTE: its
 * eddsa internals call the global `Buffer`, absent in the browser — the /claim
 * page (Task 6) adds a webpack Buffer ProvidePlugin. Signing needs no randomness.
 */
import { buildEddsa, buildPoseidon } from "circomlibjs";

// DOM_PODMSG (DESIGN §5.2): proof-of-delivery message tag. Mirrors
// prover-dist/lib/constants.ts; a bare Poseidon call is a spec violation.
const DOM_PODMSG = 5n;

// circomlibjs instances are async + heavy; build once per page session.
let eddsaInstance: Awaited<ReturnType<typeof buildEddsa>> | null = null;
let poseidonInstance: Awaited<ReturnType<typeof buildPoseidon>> | null = null;

async function getEddsa() {
  if (eddsaInstance === null) eddsaInstance = await buildEddsa();
  return eddsaInstance;
}
async function getPoseidon() {
  if (poseidonInstance === null) poseidonInstance = await buildPoseidon();
  return poseidonInstance;
}

/** hex string → Uint8Array. Browser-safe: does not depend on a global Buffer. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("seedHex must have an even length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error("seedHex is not valid hex");
    out[i] = byte;
  }
  return out;
}

export interface SignPodBrowserArgs {
  seedHex: string;
  shipmentId: number;
  carrierPkCommit: string;
  cellRd: string;
  ts: number;
}

/**
 * Sign the PoD message in the browser with the recipient's claim key.
 * Returns the EdDSA-Poseidon signature as decimal strings: R8 = [R8x, R8y], S.
 */
export async function signPodBrowser(
  args: SignPodBrowserArgs,
): Promise<{ R8: [string, string]; S: string }> {
  const [eddsa, poseidon] = await Promise.all([getEddsa(), getPoseidon()]);
  const bjF = eddsa.babyJub.F;
  const seed = hexToBytes(args.seedHex);

  // m = Poseidon(DOM_PODMSG, shipment_id, carrier_pk_commit, cell_rd, ts).
  // Decimal string, then re-encode into the signing field via bjF.e(...) —
  // identical to prover-dist/recipient.ts signPod.
  const msgDec = poseidon.F.toString(
    poseidon([
      DOM_PODMSG,
      BigInt(args.shipmentId),
      BigInt(args.carrierPkCommit),
      BigInt(args.cellRd),
      BigInt(args.ts),
    ]),
  );
  const sig = eddsa.signPoseidon(seed, bjF.e(BigInt(msgDec)));

  return {
    R8: [bjF.toObject(sig.R8[0]).toString(), bjF.toObject(sig.R8[1]).toString()],
    S: sig.S.toString(),
  };
}
```

- [ ] **Step 6: Run the test — confirm GREEN.**
```bash
cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun test lib/pod/sign-browser.test.ts
```
Expected (4 pass, 0 fail, exit 0):
```
lib/pod/sign-browser.test.ts:
(pass) hexToBytes decodes a 32-byte seed and tolerates a 0x prefix
(pass) signPodBrowser matches the pinned golden vector
(pass) signPodBrowser signature is accepted by eddsa.verifyPoseidon (client parity)
(pass) verifyPoseidon rejects the signature under a tampered ts

 4 pass
 0 fail
```

- [ ] **Step 7: Type-check (module ships to the client bundle).**
```bash
cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bunx tsc --noEmit; echo "exit=$?"
```
Expected: no diagnostics, `exit=0`.

- [ ] **Step 8: Lint.**
```bash
cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun run lint; echo "exit=$?"
```
Expected: no ESLint warnings or errors, `exit=0`.

- [ ] **Step 9: Commit.**
```bash
cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard
git add lib/pod/sign-browser.ts lib/pod/circomlibjs.d.ts lib/pod/sign-browser.test.ts types/bun-test.d.ts
git commit -m "feat(marketplace): browser PoD signing via circomlibjs (signPodBrowser) + parity test"
```
Expected: one commit created (4 files, or 3 if `types/bun-test.d.ts` was already added by a sibling task).


### Task 5: Market API (list + credential-gated claim)

**Files:**
- `dashboard/lib/types.ts` — add `MarketClaimResult` (extends Task 3's `MarketClaimRes`).
- `dashboard/lib/market/claim-gate.ts` — **new**, pure (no `server-only`, no `"use client"`): the credential-gate decision + packet sanitizer.
- `dashboard/lib/market/claim-gate.test.ts` — **new**, `bun:test` (TDD).
- `dashboard/lib/server/flows.ts` — add `marketListFlow` + `marketClaimFlow`.
- `dashboard/app/api/market/route.ts` — **new**, `GET` (board) + `POST` (claim).
- `dashboard/lib/api.ts` — add `api.market.list` / `api.market.claim`.

**Interfaces:**

*Consumes (Task 2 store):*
- `store.listOpenListings(): Promise<string[]>`
- `store.getListing(id: string|number): Promise<Listing|undefined>`
- `store.getCarrier(address: string): Promise<CarrierStatus>` — returns `{ credentialed: false }` for an unknown address
- `store.getShip(id: string|number): Promise<ShipRecord|undefined>` — async (Task 2, KV-backed); await it

*Consumes (Task 3 types):* `Listing`, `MarketClaimReq { shipmentId: number }`, `MarketClaimRes { packet: unknown }`, `CarrierStatus { credentialed: boolean; onboardedAt? }`

*Produces:*
- `types.ts`: `MarketClaimResult = ({ credentialed: true } & MarketClaimRes) | { credentialed: false; onboard: {title,cta,href} }`
- `lib/market/claim-gate.ts`: `sealPacketForCarrier(packet: unknown): unknown`, `decideClaim(credentialed: boolean, revealPacket: () => unknown): MarketClaimResult`, `CARRIER_ONBOARD_CTA`
- `flows.ts`: `marketListFlow(): Promise<Listing[]>`, `marketClaimFlow(shipmentId: number, address: string): Promise<MarketClaimResult>`
- `app/api/market/route.ts`: `GET → ok(Listing[])`, `POST {shipmentId, address} → ok(MarketClaimResult)`
- `api.ts`: `api.market.list(): Promise<ActionResult<Listing[]>>`, `api.market.claim(shipmentId, address): Promise<ActionResult<MarketClaimResult>>`

> **POST wire body** is `{ shipmentId, address }`: `shipmentId` is `MarketClaimReq`, `address` is a sibling field = the connected wallet (the caller identity used for the credential gate). Per spec §9 the sealed packet is released **only to credentialed carriers**, and the recipient's claim seed (`recipient_claim.eddsa_seed_hex`, confirmed present in `prover-dist/lib/packet.d.ts`) is stripped before it ever leaves the server — it travels only in the claim-link fragment.

---

- [ ] **Step 1: Add `MarketClaimResult` to `lib/types.ts`.**
  Append to the end of `dashboard/lib/types.ts` (after Task 3's `MarketClaimRes`):
  ```ts
  /**
   * POST /api/market claim result. Credentialed carriers get the sealed packet
   * (recipient claim seed already stripped, Task 5); non-credentialed callers get
   * a structured onboarding CTA — never a bare error (spec §10). The `packet` arm
   * is exactly MarketClaimRes plus a `credentialed` discriminator.
   */
  export type MarketClaimResult =
    | ({ credentialed: true } & MarketClaimRes)
    | { credentialed: false; onboard: { title: string; cta: string; href: string } };
  ```

- [ ] **Step 2 (TDD red): write the failing gate test.**
  Create `dashboard/lib/market/claim-gate.test.ts`:
  ```ts
  import { test, expect } from "bun:test";
  import { decideClaim, sealPacketForCarrier, CARRIER_ONBOARD_CTA } from "./claim-gate";

  const PACKET = {
    version: 1,
    c_s: "123",
    cs_opening: { sku_hash: "9", recipient_pk_x: "7", recipient_pk_y: "8" },
    dest_region: { root: "42", cells: [], paths: [] },
    recipient_claim: { eddsa_seed_hex: "deadbeef" }, // SECRET — must never reach the carrier
  };

  test("non-credentialed carrier gets the onboarding CTA and the packet is never revealed", () => {
    let revealed = false;
    const r = decideClaim(false, () => {
      revealed = true;
      return PACKET;
    });
    expect(revealed).toBe(false); // privacy: sealed packet not even read for a non-credentialed caller
    expect(r).toEqual({ credentialed: false, onboard: CARRIER_ONBOARD_CTA });
  });

  test("credentialed carrier receives the sealed packet with the recipient claim seed stripped", () => {
    const r = decideClaim(true, () => PACKET);
    expect(r.credentialed).toBe(true);
    if (!r.credentialed) throw new Error("unreachable");
    const p = r.packet as Record<string, unknown>;
    expect(p.recipient_claim).toBeUndefined(); // seed dropped
    expect(p.c_s).toBe("123"); // T12-verify material kept
    expect((p.cs_opening as Record<string, unknown>).recipient_pk_x).toBe("7");
    expect((p.dest_region as Record<string, unknown>).root).toBe("42");
  });

  test("sealPacketForCarrier strips recipient_claim and passes through non-objects", () => {
    const sealed = sealPacketForCarrier(PACKET) as Record<string, unknown>;
    expect("recipient_claim" in sealed).toBe(false);
    expect(sealPacketForCarrier(undefined)).toBeUndefined();
  });
  ```
  Run:
  ```
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun test lib/market/claim-gate.test.ts
  ```
  Expected: **fails** — `error: Cannot find module './claim-gate'` (0 pass). Red confirmed.

- [ ] **Step 3 (TDD green): implement the gate module.**
  Create `dashboard/lib/market/claim-gate.ts`:
  ```ts
  // Pure credential-gate logic for POST /api/market claim. No server-only / no
  // "use client" — importable by both flows.ts (server) and bun:test.
  import type { MarketClaimResult } from "../types";

  /** Shown to a non-credentialed carrier instead of a bare rejection (spec §10). */
  export const CARRIER_ONBOARD_CTA = {
    title: "Become a carrier",
    cta: "Get credentialed",
    href: "/market?onboard=1",
  } as const;

  /**
   * Strip recipient-private material before a sealed packet leaves the server for
   * a carrier. The recipient's EdDSA claim seed (`recipient_claim.eddsa_seed_hex`)
   * is the recipient's signing capability — it travels ONLY in the claim-link URL
   * fragment, NEVER to the carrier (spec §5/§9). The carrier's T12 verify recomputes
   * C_S from `cs_opening` + `dest_region`, so the seed is not needed here.
   */
  export function sealPacketForCarrier(packet: unknown): unknown {
    if (!packet || typeof packet !== "object") return packet;
    const src = packet as Record<string, unknown>;
    const safe: Record<string, unknown> = {};
    for (const k of Object.keys(src)) {
      if (k === "recipient_claim") continue; // dropped on purpose — recipient's key
      safe[k] = src[k];
    }
    return safe;
  }

  /**
   * The credential gate. `revealPacket` is a thunk invoked ONLY for a credentialed
   * carrier — a non-credentialed caller never triggers the store read, so the
   * sealed packet never leaves the mailbox for them.
   */
  export function decideClaim(
    credentialed: boolean,
    revealPacket: () => unknown,
  ): MarketClaimResult {
    if (!credentialed) {
      return { credentialed: false, onboard: CARRIER_ONBOARD_CTA };
    }
    return { credentialed: true, packet: sealPacketForCarrier(revealPacket()) };
  }
  ```
  Run:
  ```
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun test lib/market/claim-gate.test.ts
  ```
  Expected: **`3 pass, 0 fail`**. Green.

- [ ] **Step 4: wire the two flows into `lib/server/flows.ts`.**
  (a) In the `from "../types"` type-import block, add `Listing` and `MarketClaimResult`. Change:
  ```ts
    AuditRes,
    ConfSettleRelease,
  } from "../types";
  ```
  to:
  ```ts
    AuditRes,
    ConfSettleRelease,
    Listing,
    MarketClaimResult,
  } from "../types";
  ```
  (b) Immediately after the `import type { CarrierBJJ, ShipMeta } from "./store";` line, add the gate import:
  ```ts
  import { decideClaim } from "../market/claim-gate";
  ```
  (c) Append the two flows to the end of the file:
  ```ts

  // ── market board (Task 5) ─────────────────────────────────────────────────────

  /**
   * GET /api/market — the carrier board. Reads the openListings index and hydrates
   * each row from its listing:<id> summary (only on-chain-public metadata; amount is
   * null on the confidential rail — spec §9). Newest first. The KV index is a fast
   * cache over the registry, which stays the source of truth.
   */
  export async function marketListFlow(): Promise<Listing[]> {
    const ids = await store.listOpenListings();
    const rows: Listing[] = [];
    for (const id of ids) {
      const l = await store.getListing(id);
      if (l) rows.push(l);
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return rows;
  }

  /**
   * POST /api/market — credential-gated claim. A credentialed carrier receives the
   * sealed packet (recipient claim seed stripped) to verify T12 and then accept;
   * a non-credentialed caller gets a structured onboarding CTA (spec §3/§9/§10).
   * `address` is the connected wallet (the caller identity). The packet is read
   * ONLY once the credential check passes (decideClaim's thunk).
   */
  export async function marketClaimFlow(
    shipmentId: number,
    address: string,
  ): Promise<MarketClaimResult> {
    if (!address) throw new Error("address (connected wallet) required");
    const carrier = await store.getCarrier(address);
    return decideClaim(carrier.credentialed, () => {
      const rec = store.getShip(shipmentId);
      if (!rec) {
        throw new Error(`no stored packet for shipment ${shipmentId} — create it via this server first`);
      }
      return rec.packet;
    });
  }
  ```

- [ ] **Step 5: create the route `app/api/market/route.ts`.**
  ```ts
  export const runtime = "nodejs";
  export const dynamic = "force-dynamic";

  import { NextResponse } from "next/server";
  import { marketListFlow, marketClaimFlow, ok, fail } from "@/lib/server/flows";
  import type { MarketClaimReq } from "@/lib/types";

  /** GET /api/market — the open-shipments board (openListings → listing:<id>). */
  export async function GET() {
    try {
      return NextResponse.json(ok(await marketListFlow()));
    } catch (e) {
      return NextResponse.json(fail(e));
    }
  }

  /**
   * POST /api/market — credential-gated claim.
   * Body: { shipmentId, address } — shipmentId is the job; address is the connected
   * wallet (the caller identity gated on carrier:<address>.credentialed).
   */
  export async function POST(req: Request) {
    try {
      const body = (await req.json()) as MarketClaimReq & { address?: string };
      if (typeof body?.shipmentId !== "number") throw new Error("shipmentId (number) required");
      if (typeof body?.address !== "string" || !body.address) {
        throw new Error("address (connected wallet) required");
      }
      return NextResponse.json(ok(await marketClaimFlow(body.shipmentId, body.address)));
    } catch (e) {
      return NextResponse.json(fail(e));
    }
  }
  ```

- [ ] **Step 6: add `api.market` to `lib/api.ts`.**
  (a) Add `Listing, MarketClaimResult` to the `from "./types"` import — change:
  ```ts
    VerifyRes, FlyInputRes, ProveInputRes, SignPodReq, AuditRes, ShipmentReq, RoleInfo,
  } from "./types";
  ```
  to:
  ```ts
    VerifyRes, FlyInputRes, ProveInputRes, SignPodReq, AuditRes, ShipmentReq, RoleInfo,
    Listing, MarketClaimResult,
  } from "./types";
  ```
  (b) Add the `market` block after the `roleInfo:` entry (before the closing `};`):
  ```ts
    roleInfo:     (address: string) => get<RoleInfo>(`/api/role?address=${encodeURIComponent(address)}`),
    // marketplace board + credential-gated claim (Task 5)
    market: {
      list:  ()                                    => get<Listing[]>("/api/market"),
      claim: (shipmentId: number, address: string) =>
               post<MarketClaimResult>("/api/market", { shipmentId, address }),
    },
  };
  ```

- [ ] **Step 7: type + lint gates.**
  ```
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bunx tsc --noEmit && bun run lint
  ```
  Expected: both exit `0` (tsc prints nothing; lint prints no errors/warnings for the new files).

- [ ] **Step 8: build + runtime curl (GET board + non-credentialed claim).**
  ```
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun run build
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun run start -- -p 3599 &
  sleep 6
  curl -s http://localhost:3599/api/market
  echo
  curl -s -X POST http://localhost:3599/api/market -H 'content-type: application/json' -d '{"shipmentId":1,"address":"GNOTCREDENTIALED"}'
  echo
  kill %1
  ```
  Expected:
  - `bun run build` exits `0`.
  - GET → `{"ok":true,"data":[]}` (empty board when no `OPEN` listings exist yet).
  - POST (unknown → non-credentialed, so the packet is never read) → `{"ok":true,"data":{"credentialed":false,"onboard":{"title":"Become a carrier","cta":"Get credentialed","href":"/market?onboard=1"}}}`

  This exercises both the board read (`listOpenListings`→`getListing`) and the credential gate (`getCarrier` default `credentialed:false`) end-to-end. The credentialed-claim path (packet returned) is covered by the Step 3 unit test and is validated live in the full lifecycle run (spec §11, requires a funded wallet + credentialed carrier).

- [ ] **Step 9: commit.**
  ```
  cd /Users/dadadave/Dev/Stellar/aegis-relay && git add dashboard/lib/types.ts dashboard/lib/market/claim-gate.ts dashboard/lib/market/claim-gate.test.ts dashboard/lib/server/flows.ts dashboard/app/api/market/route.ts dashboard/lib/api.ts && git commit -m "feat(market): GET board + credential-gated POST claim API

- GET /api/market lists openListings→getListing (newest first)
- POST /api/market {shipmentId,address} gates on getCarrier(address).credentialed
- credentialed → sealed packet with recipient claim seed stripped (spec §9)
- non-credentialed → structured onboarding CTA, packet never read
- add marketListFlow/marketClaimFlow, api.market.list/claim, MarketClaimResult
- TDD: lib/market/claim-gate.ts pure gate + seal, bun:test green"
  ```


### Task 6: Recipient claim page (`app/claim/[id]/page.tsx`, `app/api/claim/route.ts`, `app/api/claim/[id]/route.ts`)

The recipient arrives via the merchant-minted claim link `/claim/<id>#<seedHex>`. The page reads the seed from the URL **fragment** (never sent to the server), fetches the signing context, signs the PoD **in the browser** with `signPodBrowser` (Task 4), and POSTs only the signature. The server stores it as the `Pod` on `ship:<id>` — the exact shape the A1 delivery witness reads (mirrors `prover-dist/recipient.js` `signPod`).

**Files:**
- `dashboard/lib/pod/pod-record.ts` (new, pure) — `podRecord()` maps a browser signature + quantized coords to the mailbox `Pod` shape.
- `dashboard/lib/pod/pod-record.test.ts` (new, `bun:test`) — TDD for `podRecord`.
- `dashboard/lib/server/flows.ts` (edit, additive) — `claimContextFlow`, `recordPodFlow` + imports.
- `dashboard/app/api/claim/[id]/route.ts` (new) — `GET` → `ClaimContext`.
- `dashboard/app/api/claim/route.ts` (new) — `POST` → store PoD.
- `dashboard/lib/api.ts` (edit, additive) — `claimContext`, `claimPod` client helpers.
- `dashboard/app/claim/[id]/page.tsx` (new, `"use client"`) — recipient page.

**Interfaces:**
- **Consumes:**
  - `signPodBrowser(args: { seedHex: string; shipmentId: number; carrierPkCommit: string; cellRd: string; ts: number }): Promise<{ R8: [string,string]; S: string }>` — Task 4 (`lib/pod/sign-browser.ts`, must exist before this task's build gate).
  - `store.getClaimContext(token): Promise<ClaimContext|undefined>`, `store.getShip(id)` (async — await; Task 2), `store.updateShip(id, patch)` — Task 2.
  - `ClaimContext`, `PodSignReq` — Task 3 (`lib/types.ts`).
  - `prover-dist`: `latLonToQ`, `mortonCell`, `RD_RES`, `type Pod` (already vendored).
  - `components/ds/*`: `Button`, `Stamp`, `ChainDatum`, `Honesty`.
- **Produces:**
  - `podRecord(sig: PodEnvelope, latQ: bigint|number|string, lonQ: bigint|number|string): PodRecord` + `PodEnvelope`/`PodRecord` types.
  - `claimContextFlow(id: number): Promise<ClaimContext>` — KV context wins, else derives from the mailbox packet.
  - `recordPodFlow(req: PodSignReq): Promise<{ signed: boolean }>`.
  - `api.claimContext(id: number)`, `api.claimPod(b: PodSignReq)`.
  - `GET /api/claim/<id>`, `POST /api/claim`, and the `/claim/[id]` page.

> `ClaimContext.destRegion` (typed `unknown` in the shared contract) is shaped by `claimContextFlow` as `{ lat: number; lon: number; cellRd: string }` — the committed delivery region cell plus its coords for the location confirm. The browser signs over `cellRd`; the server persists `lat_q`/`lon_q` derived from the same coords, so `cell_rd` stays consistent for the delivery proof. `tsWindow` is the exact `ts` the recipient signs at (echoed back in the POST so the stored `Pod.ts` matches the signed message).

---

- [ ] **Step 1: Write the failing `podRecord` test first (TDD red).** Create `dashboard/lib/pod/pod-record.test.ts`:

```ts
import { test, expect } from "bun:test";
import { podRecord, type PodEnvelope } from "./pod-record";

const sig: PodEnvelope = { R8: ["111", "222"], S: "333", ts: 1751500000 };

test("podRecord maps a browser signature + quantized coords to the Pod shape", () => {
  const pod = podRecord(sig, 8461234n, 16777000n);
  expect(pod).toEqual({
    R8x: "111",
    R8y: "222",
    S: "333",
    ts: "1751500000",
    lat_q: "8461234",
    lon_q: "16777000",
  });
});

test("podRecord stringifies a numeric or string ts consistently", () => {
  expect(podRecord({ ...sig, ts: "1751500000" }, 1, 2).ts).toBe("1751500000");
  expect(podRecord({ ...sig, ts: 42 }, 1, 2).ts).toBe("42");
});

test("podRecord rejects a malformed R8", () => {
  // @ts-expect-error — R8 must be a 2-tuple
  expect(() => podRecord({ R8: ["x"], S: "1", ts: 1 }, 1, 2)).toThrow("R8 must be [x, y]");
});

test("podRecord rejects an empty S", () => {
  expect(() => podRecord({ R8: ["1", "2"], S: "", ts: 1 }, 1, 2)).toThrow("S (decimal string) required");
});
```

Run it — it must fail because the module does not exist yet:

```
cd dashboard && bun test lib/pod/pod-record.test.ts
```

Expected: `error: Cannot find module '.../lib/pod/pod-record'` (test run fails). This is the red state.

---

- [ ] **Step 2: Make it green — create the pure `podRecord` module.** Create `dashboard/lib/pod/pod-record.ts`:

```ts
/**
 * pod-record.ts — pure assembly of a mailbox PoD record from a browser-produced
 * EdDSA-Poseidon signature. NO prover-dist / node deps, so it is unit-testable
 * with `bun test`. The shape mirrors prover-dist/recipient.js `signPod` output
 * exactly (R8x, R8y, S, ts, lat_q, lon_q — all decimal strings), which is what
 * the A1 delivery witness reads back at deliver time.
 */

export interface PodEnvelope {
  /** EdDSA-Poseidon R8 point, [x, y] as decimal strings (from signPodBrowser). */
  R8: [string, string];
  /** EdDSA-Poseidon scalar S, decimal string. */
  S: string;
  /** Unix ts the recipient signed at — must match the signed pod_msg. */
  ts: number | string;
}

export interface PodRecord {
  R8x: string;
  R8y: string;
  S: string;
  ts: string;
  lat_q: string;
  lon_q: string;
}

export function podRecord(
  sig: PodEnvelope,
  latQ: bigint | number | string,
  lonQ: bigint | number | string,
): PodRecord {
  if (!sig || !Array.isArray(sig.R8) || sig.R8.length !== 2) {
    throw new Error("bad PoD signature: R8 must be [x, y]");
  }
  if (typeof sig.S !== "string" || sig.S.length === 0) {
    throw new Error("bad PoD signature: S (decimal string) required");
  }
  if (sig.ts === undefined || sig.ts === null || String(sig.ts).length === 0) {
    throw new Error("bad PoD signature: ts required");
  }
  return {
    R8x: String(sig.R8[0]),
    R8y: String(sig.R8[1]),
    S: sig.S,
    ts: String(sig.ts),
    lat_q: String(latQ),
    lon_q: String(lonQ),
  };
}
```

Re-run:

```
cd dashboard && bun test lib/pod/pod-record.test.ts
```

Expected: `4 pass, 0 fail` (green).

---

- [ ] **Step 3: Add `claimContextFlow` + `recordPodFlow` to `flows.ts` (additive).** First extend the imports. Replace this line (flows.ts ~line 22):

```ts
import { latLonToQ } from "./prover-dist/lib/tree.js";
```

with:

```ts
import { latLonToQ, mortonCell } from "./prover-dist/lib/tree.js";
import { RD_RES } from "./prover-dist/lib/constants.js";
import { podRecord, type PodEnvelope } from "../pod/pod-record";
```

Then add the two new types to the `../types` import block — replace:

```ts
  ConfSettleRelease,
} from "../types";
```

with:

```ts
  ConfSettleRelease,
  ClaimContext,
  PodSignReq,
} from "../types";
```

Now insert the two flows. Anchor on the existing section comment (flows.ts ~line 427):

```ts
// ── prove delivery (A1 Groth16) ──────────────────────────────────────────────
```

and replace it with the new section **followed by** the original comment:

```ts
// ── recipient claim link (GET context + in-browser PoD store) ────────────────

/**
 * Signing context for the recipient claim page (/claim/<id>). Returns ONLY what
 * the browser needs to sign the PoD — the carrier commit, the committed dest
 * region cell (cell_rd) + its coords for the location confirm, and the ts to
 * sign at. NEVER the claim seed (that rides the URL fragment, client-only). A
 * create-time context in KV wins; otherwise it is derived from the mailbox packet.
 */
export async function claimContextFlow(id: number): Promise<ClaimContext> {
  if (!Number.isInteger(id) || id < 1) throw new Error(`not a shipment id: ${id}`);
  const stored = await store.getClaimContext(String(id));
  if (stored) return stored;

  const rec = store.getShip(id);
  if (!rec) throw new Error(`no shipment #${id} on this server — the claim link is for an unknown shipment`);
  if (!rec.carrierBJJ) {
    throw new Error(`shipment #${id} has no carrier yet — there is nothing to sign until a carrier accepts custody`);
  }

  const { latQ, lonQ } = latLonToQ(rec.meta.toLat, rec.meta.toLon);
  const cellRd = mortonCell(latQ, lonQ, RD_RES).toString();

  // ts must be strictly after accept_ts (on-chain freshness); pick a fresh one.
  let ts = Math.floor(Date.now() / 1000);
  const raw = await readShipmentRaw(id);
  if (raw.ok) {
    const acceptTs = asNumber(raw.raw.accept_ts);
    if (ts <= acceptTs) ts = acceptTs + 1;
  }

  return {
    shipmentId: id,
    carrierPkCommit: rec.carrierBJJ.commit,
    destRegion: { lat: rec.meta.toLat, lon: rec.meta.toLon, cellRd },
    tsWindow: ts,
  };
}

/**
 * Store a browser-signed proof-of-delivery against ship:<id>. The recipient
 * derived their Baby Jubjub key from the fragment seed and signed
 * m = Poseidon(DOM_PODMSG, id, carrier_pk_commit, cell_rd, ts) IN THE BROWSER;
 * only the signature (+ ts + the confirmed committed coords) reaches us. We
 * persist it in the exact Pod shape the A1 delivery witness reads. The coords are
 * the committed dest coords, so cell_rd recomputed from lat_q/lon_q matches the
 * signed message.
 */
export async function recordPodFlow(req: PodSignReq): Promise<{ signed: boolean }> {
  const { shipmentId, signature, lat, lon } = req;
  const rec = store.getShip(shipmentId);
  if (!rec) throw new Error(`no stored packet for shipment ${shipmentId}`);
  if (!rec.carrierBJJ) throw new Error(`shipment ${shipmentId} not accepted yet (no carrier commit)`);
  const { latQ, lonQ } = latLonToQ(lat, lon);
  const pod = podRecord(signature as PodEnvelope, latQ, lonQ);
  store.updateShip(shipmentId, { pod: pod as Pod });
  return { signed: true };
}

// ── prove delivery (A1 Groth16) ──────────────────────────────────────────────
```

---

- [ ] **Step 4: Create the `GET /api/claim/<id>` route.** Create `dashboard/app/api/claim/[id]/route.ts`:

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { claimContextFlow, ok, fail } from "@/lib/server/flows";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(ok(await claimContextFlow(Number(id))));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
```

---

- [ ] **Step 5: Create the `POST /api/claim` route.** Create `dashboard/app/api/claim/route.ts`:

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { recordPodFlow, ok, fail } from "@/lib/server/flows";
import type { PodSignReq } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PodSignReq;
    if (
      body.shipmentId === undefined ||
      body.signature === undefined ||
      body.lat === undefined ||
      body.lon === undefined
    ) {
      throw new Error("shipmentId, signature, lat and lon are required");
    }
    return NextResponse.json(ok(await recordPodFlow(body)));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
```

---

- [ ] **Step 6: Add the client fetch helpers to `lib/api.ts` (additive).** Extend the type import — replace:

```ts
import type {
  ShipmentView, ActionResult, BuildTxReq, BuildTxRes, SubmitTxReq, SubmitTxRes,
  VerifyRes, FlyInputRes, ProveInputRes, SignPodReq, AuditRes, ShipmentReq, RoleInfo,
} from "./types";
```

with:

```ts
import type {
  ShipmentView, ActionResult, BuildTxReq, BuildTxRes, SubmitTxReq, SubmitTxRes,
  VerifyRes, FlyInputRes, ProveInputRes, SignPodReq, AuditRes, ShipmentReq, RoleInfo,
  ClaimContext, PodSignReq,
} from "./types";
```

Then add the two helpers — replace:

```ts
  shipment:     (id: number)      => get<ShipmentView>(`/api/shipment/${id}`),
  roleInfo:     (address: string) => get<RoleInfo>(`/api/role?address=${encodeURIComponent(address)}`),
};
```

with:

```ts
  shipment:     (id: number)      => get<ShipmentView>(`/api/shipment/${id}`),
  roleInfo:     (address: string) => get<RoleInfo>(`/api/role?address=${encodeURIComponent(address)}`),
  // recipient claim link — GET signing context, POST the in-browser PoD signature
  claimContext: (id: number)      => get<ClaimContext>(`/api/claim/${id}`),
  claimPod:     (b: PodSignReq)   => post<{ signed: boolean }>("/api/claim", b),
};
```

---

- [ ] **Step 7: Create the recipient claim page.** Create `dashboard/app/claim/[id]/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ds/Button";
import { Stamp } from "@/components/ds/Stamp";
import { ChainDatum } from "@/components/ds/ChainDatum";
import { Honesty } from "@/components/ds/Honesty";
import { signPodBrowser } from "@/lib/pod/sign-browser";
import { api } from "@/lib/api";
import type { ClaimContext } from "@/lib/types";

/** Shape of ClaimContext.destRegion produced by claimContextFlow (typed unknown
 *  in the shared contract, narrowed here for the location confirm + signing). */
interface DestRegion {
  lat: number;
  lon: number;
  cellRd: string;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--void-0)", minHeight: "100vh" }}>
      <header
        style={{
          borderBottom: "1px solid var(--hairline)",
          background: "linear-gradient(var(--panel-cold), var(--panel-cold)), var(--void-1)",
        }}
      >
        <div
          className="mx-auto"
          style={{
            maxWidth: 720,
            padding: "14px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <Link href="/" className="display" style={{ fontSize: "var(--text-md)", fontWeight: 700 }}>
            AEGIS<span style={{ color: "var(--seal)" }}>&nbsp;RELAY</span>
          </Link>
          <Stamp tone="seal">Recipient view — the claim key never leaves this device</Stamp>
        </div>
      </header>
      <div className="mx-auto" style={{ maxWidth: 720, padding: "40px 24px 72px" }}>
        {children}
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel-cold" style={{ padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
      {children}
    </div>
  );
}

export default function ClaimPage() {
  const params = useParams<{ id: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = Number(rawId);

  const [seedHex, setSeedHex] = useState<string>("");
  const [ctx, setCtx] = useState<ClaimContext | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // The claim seed rides in the URL fragment and is read client-side ONLY.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setSeedHex(window.location.hash.replace(/^#/, "").trim());
  }, []);

  useEffect(() => {
    if (!Number.isInteger(id) || id < 1) {
      setLoadErr(`"${String(rawId).slice(0, 40)}" is not a shipment id.`);
      setLoaded(true);
      return;
    }
    let live = true;
    (async () => {
      const res = await api.claimContext(id);
      if (!live) return;
      if (!res.ok || !res.data) setLoadErr(res.error ?? `No delivery to sign for shipment #${id}.`);
      else setCtx(res.data);
      setLoaded(true);
    })();
    return () => {
      live = false;
    };
  }, [id, rawId]);

  const onSign = useCallback(async () => {
    if (!ctx || !seedHex) return;
    const dest = ctx.destRegion as DestRegion;
    setBusy(true);
    setResult(null);
    try {
      const sig = await signPodBrowser({
        seedHex,
        shipmentId: ctx.shipmentId,
        carrierPkCommit: ctx.carrierPkCommit,
        cellRd: dest.cellRd,
        ts: ctx.tsWindow,
      });
      const res = await api.claimPod({
        shipmentId: ctx.shipmentId,
        signature: { R8: sig.R8, S: sig.S, ts: ctx.tsWindow },
        lat: dest.lat,
        lon: dest.lon,
      });
      setResult(
        res.ok
          ? {
              ok: true,
              msg: "Proof of delivery signed in your browser and handed to the carrier. You can close this page.",
            }
          : { ok: false, msg: res.error ?? "Could not record the signature." },
      );
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, [ctx, seedHex]);

  if (!loaded) {
    return (
      <Shell>
        <Card>
          <p className="mono" style={{ color: "var(--ink-dim)", fontSize: "var(--text-sm)" }}>
            Reading the claim context…
          </p>
        </Card>
      </Shell>
    );
  }

  if (loadErr || !ctx) {
    return (
      <Shell>
        <Card>
          <Stamp tone="caution">Claim link</Stamp>
          <p className="display" style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 600 }}>
            Nothing to sign here
          </p>
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
            {loadErr}
          </p>
          <Honesty>
            A claim link only becomes signable once a carrier has accepted custody of the shipment.
            If you just received this link, check back shortly.
          </Honesty>
          {Number.isInteger(id) && id >= 1 && (
            <Link href={`/track/${id}`} style={{ fontSize: "var(--text-sm)", color: "var(--seal)" }}>
              track this shipment →
            </Link>
          )}
        </Card>
      </Shell>
    );
  }

  const dest = ctx.destRegion as DestRegion;

  if (result?.ok) {
    return (
      <Shell>
        <Card>
          <Stamp tone="verified">Proof of delivery · signed</Stamp>
          <p className="display" style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 600 }}>
            Signed on this device ✓
          </p>
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
            {result.msg}
          </p>
          <Link href={`/track/${ctx.shipmentId}`} style={{ fontSize: "var(--text-sm)", color: "var(--seal)" }}>
            track shipment #{ctx.shipmentId} →
          </Link>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <h1 className="display" style={{ margin: 0, fontSize: "var(--text-xl)" }}>
          Confirm delivery of <span className="mono" style={{ color: "var(--chain)" }}>#{ctx.shipmentId}</span>
        </h1>
        <Stamp tone="seal">EdDSA-Poseidon · in-browser</Stamp>
      </div>
      <Card>
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
          You hold the claim key for this shipment. Confirm you have received it at the committed
          location and sign the proof of delivery — the signature is computed here, in your browser,
          and only the signature is sent on.
        </p>

        <ChainDatum
          label="carrier_pk_commit"
          value={ctx.carrierPkCommit}
          sub="the custody commitment you are signing against"
          full
        />
        <ChainDatum
          label="dest region cell (cell_rd)"
          value={dest.cellRd}
          sub={`committed delivery region · ${dest.lat.toFixed(5)}, ${dest.lon.toFixed(5)}`}
          full
        />

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            fontSize: "var(--text-sm)",
            color: "var(--ink)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            style={{ marginTop: 3, accentColor: "var(--seal)" }}
          />
          <span>
            I confirm I received this shipment at {dest.lat.toFixed(5)}, {dest.lon.toFixed(5)}.
          </span>
        </label>

        {!seedHex && (
          <Honesty>
            This link is missing its claim key (the <span className="mono">#…</span> fragment). Open
            the full link exactly as it was shared with you — the part after{" "}
            <span className="mono">#</span> is your signing key and is never sent to the server.
          </Honesty>
        )}

        <Button
          variant="seal"
          full
          loading={busy}
          loadingLabel="Signing in your browser…"
          disabled={!seedHex || !confirmed}
          onClick={onSign}
        >
          Sign proof of delivery
        </Button>

        {result && !result.ok && (
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--danger)", lineHeight: "var(--lh-body)" }}>
            {result.msg}
          </p>
        )}

        <Honesty>
          Holding this link <em>is</em> being the recipient — it is a bearer capability. The seed
          stays in this browser tab and is never transmitted; the server never holds your claim key.
        </Honesty>
      </Card>
    </Shell>
  );
}
```

---

- [ ] **Step 8: Type + lint gate.** Confirm the new flows, routes, helpers, and page all type-check and lint clean:

```
cd dashboard && bunx tsc --noEmit && bun run lint
```

Expected: `tsc` prints nothing (exit 0); lint prints `✔ No ESLint warnings or errors` (or equivalent, exit 0). If `tsc` reports `store.getClaimContext is not a function`-shaped type errors, Task 2 (KV store) is not yet merged — it is a hard dependency of this task.

---

- [ ] **Step 9: Build gate.** Full production build must succeed with the new routes registered:

```
cd dashboard && bun run build
```

Expected: exit 0; the route table lists `ƒ /claim/[id]`, `ƒ /api/claim`, and `ƒ /api/claim/[id]`. (If the build fails on `Cannot find module '@/lib/pod/sign-browser'`, Task 4 is not yet merged — it is a hard dependency.)

---

- [ ] **Step 10: Runtime check — graceful GET + page render for a non-existent shipment.** Serve the production build and exercise `/claim/1` (no shipment in a fresh store → graceful terminal state):

```
cd dashboard && (bun run start -- -p 3939 >/tmp/claim-check.log 2>&1 &) && \
  for i in $(seq 1 20); do curl -sf http://localhost:3939/claim/1 >/dev/null 2>&1 && break; sleep 1; done && \
  echo "=== GET /api/claim/1 ===" && curl -s http://localhost:3939/api/claim/1 && echo && \
  echo "=== POST /api/claim (validation) ===" && curl -s -X POST http://localhost:3939/api/claim -H 'content-type: application/json' -d '{}' && echo && \
  echo "=== /claim/1 HTML ===" && curl -s http://localhost:3939/claim/1 | grep -o -e 'AEGIS' -e 'Reading the claim context' | sort -u; \
  pkill -f "next start -p 3939"
```

Expected:
- `GET /api/claim/1` → `{"ok":false,"error":"no shipment #1 on this server — the claim link is for an unknown shipment"}` (graceful, never a 500 crash).
- `POST /api/claim` with `{}` → `{"ok":false,"error":"shipmentId, signature, lat and lon are required"}`.
- `/claim/1` HTML → prints both `AEGIS` and `Reading the claim context` (the SSR shell renders — the client then swaps to the terminal "Nothing to sign here" card after the fetch resolves).

---

- [ ] **Step 11: Commit.**

```
cd /Users/dadadave/Dev/Stellar/aegis-relay && \
git add dashboard/lib/pod/pod-record.ts dashboard/lib/pod/pod-record.test.ts \
        dashboard/lib/server/flows.ts dashboard/lib/api.ts \
        dashboard/app/api/claim/route.ts "dashboard/app/api/claim/[id]/route.ts" \
        "dashboard/app/claim/[id]/page.tsx" && \
git commit -m "feat(marketplace): recipient claim page + in-browser PoD (/claim/[id], /api/claim)

- claimContextFlow returns the minimal signing context (carrier commit, dest
  cell_rd + coords, ts); KV context wins, else derived from the mailbox packet
- recordPodFlow persists the browser EdDSA-Poseidon signature as ship:<id>.pod
- pod-record.ts: pure, bun-tested Pod-shape assembly (TDD)
- /claim/[id] client page reads the seed from the URL fragment, signs the PoD
  in-browser via signPodBrowser, POSTs only the signature
- api.claimContext / api.claimPod client helpers"
```

Expected: a single commit on `main`'s working branch; `git status` clean afterward.


### Task 7: Market board page + notifications poll (`app/market/page.tsx`)

Public carrier board at `/market`: polls `api.market.list` on an interval (live add/remove + a toast when a new listing appears), filters by lane / escrow / method / deadline, and a per-row **Claim** button that calls `api.market.claim` → on success deep-links into the verify+accept flow (`/console?claim=<id>`), or surfaces **Become a carrier** when the wallet isn't credentialed. ds-styled, client-only, no wallet dependency (browsing is public per spec §9; the claim route owns carrier identity).

**Files:**
- `dashboard/lib/market/board.ts` (new) — pure, client-safe board helpers (filtering + new-listing diffing). No SDK/server imports so it is unit-testable under `bun test`. (`contract.ts` is server-only, so its `utcDay` cannot be imported here — a client-safe copy lives in this module.)
- `dashboard/lib/market/board.test.ts` (new) — `bun:test` for the pure helpers (TDD, failing first).
- `dashboard/app/market/page.tsx` (new) — the `/market` route (client).

**Interfaces:**
- **Produces:**
  - Route `GET /market` (client page).
  - `lib/market/board.ts` exports:
    - `interface BoardFilters { laneId: number | null; minAmount: number | null; method: Method | "all"; withinHours: number | null }`
    - `const EMPTY_FILTERS: BoardFilters`
    - `filterListings(listings: Listing[], f: BoardFilters, nowSec: number): Listing[]`
    - `newlyAppeared(prevIds: number[] | null, nextIds: number[]): number[]`
    - `utcDay(tsSec: number): string`
- **Consumes:**
  - `api.market.list(): Promise<ActionResult<Listing[]>>` and `api.market.claim(b: MarketClaimReq): Promise<ActionResult<MarketClaimRes>>` — from **Task 5** (`lib/api.ts` `api.market`).
  - `Listing`, `Method`, `ShipmentState`, `MarketClaimReq` — from **Task 2** (`lib/types.ts`).
  - ds: `Stamp`/`StampTone` (`@/components/ds/Stamp`), `Button` (`@/components/ds/Button`), `Segmented` (`@/components/ds/Segmented`).
  - `ToastProvider`/`useToast` (`@/components/console/toast`).

---

- [ ] **Step 1: Write the failing pure-logic test (TDD red).** Create `dashboard/lib/market/board.test.ts`:

```ts
import { test, expect } from "bun:test";
import { filterListings, newlyAppeared, EMPTY_FILTERS, type BoardFilters } from "./board";
import type { Listing } from "@/lib/types";

const L = (o: Partial<Listing> & { shipmentId: number }): Listing => ({
  amount: "100",
  method: "courier",
  laneId: 7,
  escrowDeadline: 2_000_000_000,
  state: "OPEN",
  createdAt: 1_700_000_000,
  ...o,
});
const NOW = 1_700_000_000;

test("filterListings: EMPTY_FILTERS keeps everything", () => {
  const ls = [L({ shipmentId: 1 }), L({ shipmentId: 2, method: "drone" })];
  expect(filterListings(ls, EMPTY_FILTERS, NOW).map((l) => l.shipmentId)).toEqual([1, 2]);
});

test("filterListings: laneId narrows to the lane", () => {
  const ls = [L({ shipmentId: 1, laneId: 7 }), L({ shipmentId: 2, laneId: 3 })];
  const f: BoardFilters = { ...EMPTY_FILTERS, laneId: 7 };
  expect(filterListings(ls, f, NOW).map((l) => l.shipmentId)).toEqual([1]);
});

test("filterListings: method narrows; minAmount drops smaller AND confidential(null) rows", () => {
  const ls = [
    L({ shipmentId: 1, amount: "50" }),
    L({ shipmentId: 2, amount: "150" }),
    L({ shipmentId: 3, amount: null }),
  ];
  const f: BoardFilters = { ...EMPTY_FILTERS, minAmount: 100 };
  expect(filterListings(ls, f, NOW).map((l) => l.shipmentId)).toEqual([2]);
});

test("filterListings: withinHours drops deadlines beyond now+window", () => {
  const soon = NOW + 3600;
  const far = NOW + 100 * 3600;
  const ls = [L({ shipmentId: 1, escrowDeadline: soon }), L({ shipmentId: 2, escrowDeadline: far })];
  const f: BoardFilters = { ...EMPTY_FILTERS, withinHours: 24 };
  expect(filterListings(ls, f, NOW).map((l) => l.shipmentId)).toEqual([1]);
});

test("newlyAppeared: first observation (null prev) never bursts a toast", () => {
  expect(newlyAppeared(null, [1, 2, 3])).toEqual([]);
});

test("newlyAppeared: returns only ids new since the last poll", () => {
  expect(newlyAppeared([1, 2], [2, 3, 4])).toEqual([3, 4]);
  expect(newlyAppeared([1, 2, 3], [1, 2, 3])).toEqual([]);
});
```

Run it and confirm it fails because the module does not exist yet:

```
cd dashboard && bun test lib/market/board.test.ts
```

Expected: a resolution error, e.g. `error: Cannot find module './board'` and `0 pass`.

- [ ] **Step 2: Make it green — the pure helpers.** Create `dashboard/lib/market/board.ts`:

```ts
// Pure, client-safe board helpers — filtering + new-listing diffing for the
// /market board. No @stellar/stellar-sdk and no server imports (contract.ts is
// server-only), so this module is safe in the client bundle AND under bun test.
import type { Listing, Method } from "@/lib/types";

export interface BoardFilters {
  /** null = any lane. */
  laneId: number | null;
  /** null = any; when set, confidential (null-amount) rows are dropped. XLM units. */
  minAmount: number | null;
  method: Method | "all";
  /** null = any; keep only deadlines at most `now + withinHours*3600`. */
  withinHours: number | null;
}

export const EMPTY_FILTERS: BoardFilters = {
  laneId: null,
  minAmount: null,
  method: "all",
  withinHours: null,
};

/** Apply the board filters. Pure — `nowSec` is injected so tests are deterministic. */
export function filterListings(listings: Listing[], f: BoardFilters, nowSec: number): Listing[] {
  return listings.filter((l) => {
    if (f.laneId !== null && l.laneId !== f.laneId) return false;
    if (f.method !== "all" && l.method !== f.method) return false;
    if (f.minAmount !== null) {
      if (l.amount === null) return false; // confidential rail hides the escrow
      if (Number(l.amount) < f.minAmount) return false;
    }
    if (f.withinHours !== null && l.escrowDeadline > nowSec + f.withinHours * 3600) return false;
    return true;
  });
}

/**
 * Ids present in `next` but not in `prev`. `prev === null` (the first
 * observation) returns [] so the initial board load never bursts a toast per
 * pre-existing row — only genuinely new listings notify.
 */
export function newlyAppeared(prevIds: number[] | null, nextIds: number[]): number[] {
  if (prevIds === null) return [];
  const prev = new Set(prevIds);
  return nextIds.filter((id) => !prev.has(id));
}

/** YYYY-MM-DD (UTC) for a unix-seconds deadline — client-safe (no SDK). */
export function utcDay(tsSec: number): string {
  return new Date(tsSec * 1000).toISOString().slice(0, 10);
}
```

Re-run:

```
cd dashboard && bun test lib/market/board.test.ts
```

Expected: `6 pass` / `0 fail`.

- [ ] **Step 3: Build the board page.** Create `dashboard/app/market/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Stamp, type StampTone } from "@/components/ds/Stamp";
import { Button } from "@/components/ds/Button";
import { Segmented } from "@/components/ds/Segmented";
import { ToastProvider, useToast } from "@/components/console/toast";
import { api } from "@/lib/api";
import type { Listing, Method, ShipmentState } from "@/lib/types";
import {
  filterListings,
  newlyAppeared,
  utcDay,
  EMPTY_FILTERS,
  type BoardFilters,
} from "@/lib/market/board";

const POLL_MS = 8000;
const GRID = "70px 110px 70px 150px 120px 110px";

// Toast enter animation — the console defines these keyframes in its layout;
// /market is a standalone route, so it ships its own copy.
const FADE_CSS = `
@keyframes demoFadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.demo-fade-up { animation: demoFadeUp 0.4s cubic-bezier(0.2,0,0,1) both; }`;

const STATE_TONE: Record<ShipmentState, StampTone> = {
  OPEN: "chain",
  IN_TRANSIT: "ink",
  DELIVERED: "verified",
  EXPIRED: "danger",
  UNKNOWN: "dim",
};

const inputStyle: CSSProperties = {
  minHeight: 38,
  padding: "8px 10px",
  background: "var(--void-1)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--r-control)",
  color: "var(--ink)",
  fontSize: "var(--text-sm)",
  width: 120,
};

export default function MarketPage() {
  return (
    <ToastProvider>
      <style dangerouslySetInnerHTML={{ __html: FADE_CSS }} />
      <MarketBoard />
    </ToastProvider>
  );
}

function MarketBoard() {
  const router = useRouter();
  const { toast } = useToast();

  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<number | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [filters, setFilters] = useState<BoardFilters>({ ...EMPTY_FILTERS });
  const seenRef = useRef<number[] | null>(null);

  const load = useCallback(async () => {
    const res = await api.market.list();
    if (!res.ok) {
      setError(res.error ?? "Could not reach the board");
      setLoading(false);
      return;
    }
    const next = res.data ?? [];
    setError(null);
    setListings(next);
    setLoading(false);
    const nextIds = next.map((l) => l.shipmentId);
    const fresh = newlyAppeared(seenRef.current, nextIds);
    seenRef.current = nextIds;
    if (fresh.length > 0) {
      toast({
        tone: "mint",
        title: fresh.length === 1 ? "New shipment on the board" : `${fresh.length} new shipments`,
        detail: `#${fresh.join(", #")} just opened — claim before another carrier does.`,
      });
    }
  }, [toast]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  const nowSec = Math.floor(Date.now() / 1000);
  const rows = useMemo(
    () => filterListings(listings, filters, nowSec).sort((a, b) => b.createdAt - a.createdAt),
    [listings, filters, nowSec],
  );

  const onClaim = useCallback(
    async (id: number) => {
      setClaiming(id);
      try {
        const res = await api.market.claim({ shipmentId: id });
        if (res.ok) {
          toast({ tone: "mint", title: `Claimed #${id}`, detail: "Verify T12 and accept custody in the console." });
          router.push(`/console?claim=${id}`);
          return;
        }
        const notCredentialed =
          res.errorCode === "not_credentialed" || /credential/i.test(res.error ?? "");
        if (notCredentialed) {
          setNeedsOnboarding(true);
          toast({
            tone: "amber",
            title: "Become a carrier to claim",
            detail: "This wallet isn't a credentialed carrier yet.",
          });
        } else {
          toast({ tone: "red", title: `Couldn't claim #${id}`, detail: res.error ?? "Try another shipment." });
        }
      } finally {
        setClaiming(null);
      }
    },
    [router, toast],
  );

  const setLane = (v: string) => {
    const n = Number(v);
    setFilters((f) => ({ ...f, laneId: v === "" || Number.isNaN(n) ? null : n }));
  };
  const setMin = (v: string) => {
    const n = Number(v);
    setFilters((f) => ({ ...f, minAmount: v === "" || Number.isNaN(n) ? null : n }));
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1000, padding: "40px 24px 72px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <h1 className="display" style={{ margin: 0, fontSize: "var(--text-xl)" }}>Open shipments</h1>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--verified)" }} />
          <Stamp tone="dim">Live · polling every {POLL_MS / 1000}s</Stamp>
        </span>
      </div>
      <p style={{ margin: "0 0 20px", fontSize: "var(--text-sm)", color: "var(--ink-dim)", lineHeight: "var(--lh-body)", maxWidth: 640 }}>
        Every row is an on-chain OPEN escrow. The board shows only what the chain already exposes —
        method, lane, deadline, and (transparent rail only) the escrow. Claim one to pull its sealed
        packet and accept custody first-come.
      </p>

      {needsOnboarding && (
        <div className="panel-cold" style={{ padding: 16, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", borderColor: "rgba(240,180,76,0.4)" }}>
          <div>
            <Stamp tone="caution">Not a credentialed carrier</Stamp>
            <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm)", color: "var(--ink-dim)" }}>
              Only credentialed carriers can pull a packet and accept custody.
            </p>
          </div>
          <Link href="/console?onboard=1" style={{ textDecoration: "none" }}>
            <Button variant="seal">Become a carrier</Button>
          </Link>
        </div>
      )}

      <div className="panel-cold" style={{ padding: 14, marginBottom: 16, display: "flex", gap: 18, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Stamp tone="dim">Lane</Stamp>
          <input className="mono" inputMode="numeric" placeholder="any" value={filters.laneId ?? ""} onChange={(e) => setLane(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Stamp tone="dim">Min escrow (XLM)</Stamp>
          <input className="mono" inputMode="decimal" placeholder="any" value={filters.minAmount ?? ""} onChange={(e) => setMin(e.target.value)} style={inputStyle} />
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Stamp tone="dim">Method</Stamp>
          <Segmented<"all" | Method>
            value={filters.method}
            size="sm"
            options={[
              { value: "all", label: "All" },
              { value: "courier", label: "Courier" },
              { value: "drone", label: "Drone" },
            ]}
            onChange={(m) => setFilters((f) => ({ ...f, method: m }))}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Stamp tone="dim">Deadline</Stamp>
          <Segmented<"any" | "24" | "72">
            value={filters.withinHours === null ? "any" : (String(filters.withinHours) as "24" | "72")}
            size="sm"
            options={[
              { value: "any", label: "Any" },
              { value: "24", label: "≤24h" },
              { value: "72", label: "≤72h" },
            ]}
            onChange={(v) => setFilters((f) => ({ ...f, withinHours: v === "any" ? null : Number(v) }))}
          />
        </div>
      </div>

      {error && (
        <div className="panel-cold" style={{ padding: 14, marginBottom: 16, borderColor: "rgba(255,92,92,0.4)" }}>
          <Stamp tone="danger">Board unreachable</Stamp>
          <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm)", color: "var(--ink-dim)" }}>
            {error} — retrying every {POLL_MS / 1000}s.
          </p>
        </div>
      )}

      {rows.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 720 }}>
            <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, padding: "0 14px 8px" }}>
              <Stamp tone="dim">#</Stamp>
              <Stamp tone="dim">Method</Stamp>
              <Stamp tone="dim">Lane</Stamp>
              <Stamp tone="dim">Escrow</Stamp>
              <Stamp tone="dim">Deadline</Stamp>
              <span />
            </div>
            {rows.map((l) => (
              <div key={l.shipmentId} className="panel-cold demo-fade-up" style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, alignItems: "center", padding: 14, marginBottom: 8 }}>
                <Link href={`/track/${l.shipmentId}`} className="mono" style={{ color: "var(--chain)", fontSize: "var(--text-sm)", textDecoration: "none" }}>
                  #{l.shipmentId}
                </Link>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--ink)" }}>{l.method === "drone" ? "Drone" : "Courier"}</span>
                <span className="mono" style={{ fontSize: "var(--text-sm)", color: "var(--ink-dim)" }}>{l.laneId ?? "—"}</span>
                <span className="mono" style={{ fontSize: "var(--text-sm)", color: l.amount === null ? "var(--ink-dim)" : "var(--chain)" }}>
                  {l.amount === null ? "confidential" : `${l.amount} XLM`}
                </span>
                <span className="mono" style={{ fontSize: "var(--text-sm)", color: "var(--ink-dim)" }}>{utcDay(l.escrowDeadline)}</span>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  {l.state === "OPEN" ? (
                    <Button
                      variant="seal"
                      loading={claiming === l.shipmentId}
                      loadingLabel="Claiming…"
                      onClick={() => void onClaim(l.shipmentId)}
                      style={{ minHeight: 38, padding: "8px 16px" }}
                    >
                      Claim
                    </Button>
                  ) : (
                    <Stamp tone={STATE_TONE[l.state]}>{l.state.replace("_", " ")}</Stamp>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : loading ? (
        <div className="panel-cold" style={{ padding: 24, textAlign: "center" }}>
          <Stamp tone="dim">Loading the board…</Stamp>
        </div>
      ) : (
        <div className="panel-cold" style={{ padding: 32, textAlign: "center" }}>
          <p className="display" style={{ margin: 0, fontSize: "var(--text-md)" }}>
            {listings.length === 0 ? "No open shipments yet" : "Nothing matches these filters"}
          </p>
          <p style={{ margin: "6px 0 0", fontSize: "var(--text-sm)", color: "var(--ink-dim)" }}>
            {listings.length === 0
              ? "A merchant creates one in the console — it appears here within a few seconds."
              : "Widen the lane, escrow, method, or deadline filters."}
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck.** Run:

```
cd dashboard && bunx tsc --noEmit
```

Expected: exit code 0, no output. (Depends on Task 2's `Listing`/`Method`/`ShipmentState` in `lib/types.ts` and Task 5's `api.market` in `lib/api.ts` being present — both land before Task 7.)

- [ ] **Step 5: Lint.** Run:

```
cd dashboard && bun run lint
```

Expected: exit code 0 (no warnings/errors). If `react-hooks/exhaustive-deps` flags `nowSec`, it is intentionally in the dependency array — leave it.

- [ ] **Step 6: Production build.** Run:

```
cd dashboard && bun run build
```

Expected: exit code 0, `✓ Compiled successfully`, and the route table lists `/market` (a static/`○` client route).

- [ ] **Step 7: Runtime render check.** Start the built server on a spare port and curl the shell:

```
cd dashboard && (bun run start -- -p 4173 &) && sleep 6 && \
  curl -s http://localhost:4173/market | grep -o "Open shipments" | head -1 ; \
  curl -s http://localhost:4173/market | grep -o "Loading the board" | head -1 ; \
  kill %1 2>/dev/null || pkill -f "next start -p 4173"
```

Expected: prints `Open shipments` and `Loading the board` — the SSR'd client shell renders (the poll runs only in the browser, so the server HTML shows the loading state, confirming the page mounts without a wallet or server data). No `500`/error page in the output.

- [ ] **Step 8: Commit.** Run:

```
cd dashboard && git add app/market/page.tsx lib/market/board.ts lib/market/board.test.ts && \
  git commit -m "feat(market): /market board page with live-poll notifications and credential-gated claim"
```

Expected: one commit created with the three new files.


### Task 8: Carrier onboarding + credential gate

Wire the carrier credential lifecycle into the marketplace: a `POST /api/carrier/onboard` that marks a wallet credentialed, a `GET /api/carrier/<address>` status read, and the pure gate (`assertCarrierCredentialed`) that Task 5's `marketClaimFlow` calls before releasing a sealed packet. On-chain leaf issuance is deliberately **not** done here.

> **KEY RISK — credential-issuance authority (spec §13).** The deployed `aegis-credentials` contract exposes only `set_root(root, epoch)` gated by `issuer.require_auth()` (DESIGN §10.3); there is no per-address leaf entrypoint. Issuing a real leaf means rebuilding the depth-10 credential tree and publishing a new epoch root **signed by the issuer's Stellar key** — a key the server, by its non-custodial design (`soroban.ts` header: "The server NEVER holds a Stellar signing key"), does not have. So onboarding takes the demo shortcut: record `credentialed=true` in KV, documented with a ponytail comment. `accept` still lands because plan-001 `accept` takes the A3 credential proof as **optional** (DESIGN §8.2: "Without A3, `accept` is an authorized plain call"). Real issuance (an issuer-key-holding service publishing the root out-of-band) is roadmap.

**Files:**
- `dashboard/lib/carrier-gate.ts` (new, pure — no server deps, no `"server-only"`)
- `dashboard/lib/carrier-gate.test.ts` (new, `bun:test`)
- `dashboard/lib/server/flows.ts` (edit: extend `fail()`, add onboarding/gate/status flows)
- `dashboard/app/api/carrier/onboard/route.ts` (new)
- `dashboard/app/api/carrier/[address]/route.ts` (new)

**Interfaces:**
- **Consumes** (Task 2 store): `store.getCarrier(address: string): Promise<CarrierStatus>`, `store.setCarrierCredentialed(address: string, at: number): Promise<void>`, `store.getRep(address: string): Promise<Reputation>`.
- **Consumes** (Task 1 types): `CarrierStatus { credentialed: boolean; onboardedAt?: number }`, `Reputation { delivered: number; expired: number }`.
- **Consumes** (existing flows): `ok`, `fail` from `@/lib/server/flows`.
- **Produces** (for Task 5 + UI):
  - `assertCarrierCredentialed(address: string): Promise<void>` — throws `NotCredentialedError`; the gate Task 5's `marketClaimFlow` awaits before releasing the packet.
  - `onboardCarrierFlow(address: string): Promise<CarrierStatus>`
  - `carrierStatusFlow(address: string): Promise<{ credentialed: boolean; onboardedAt?: number; reputation: Reputation }>`
  - `NotCredentialedError` (`.errorCode === "NOT_CREDENTIALED"`), re-exported from `flows.ts`.
  - Pure (from `carrier-gate.ts`): `isValidStellarAddress(addr: string): boolean`, `ensureCredentialed(address: string, status: CarrierStatus | undefined): void`.
  - `POST /api/carrier/onboard {address}` → `ActionResult<CarrierStatus>`; `GET /api/carrier/<address>` → `ActionResult<{credentialed, onboardedAt?, reputation}>`.

---

- [ ] **Step 1: Write the failing pure-gate test (TDD red).** Create `dashboard/lib/carrier-gate.test.ts`. This tests only the pure decision logic (address shape + gate throw), so it has zero server/`server-only`/prover imports and runs in milliseconds.

```ts
import { test, expect } from "bun:test";
import {
  isValidStellarAddress,
  ensureCredentialed,
  NotCredentialedError,
} from "./carrier-gate";

// A valid-shaped ed25519 public key (same one soroban.ts uses as DUMMY_PK).
const G = "GC5Z644P4L2WUHLAK37KAO6OWF6NH3DUIH3Y5EVOQWHQ2BSHBBCE4NWN";

test("isValidStellarAddress accepts a 56-char G-address", () => {
  expect(isValidStellarAddress(G)).toBe(true);
});

test("isValidStellarAddress rejects junk / secret-seed prefix / wrong length", () => {
  expect(isValidStellarAddress("")).toBe(false);
  expect(isValidStellarAddress("nope")).toBe(false);
  expect(isValidStellarAddress("S" + G.slice(1))).toBe(false); // S… secret-seed prefix
  expect(isValidStellarAddress(G.slice(0, 55))).toBe(false); // one char short
  expect(isValidStellarAddress(G.toLowerCase())).toBe(false); // base32 is upper-only
});

test("ensureCredentialed passes for a credentialed carrier", () => {
  expect(() => ensureCredentialed(G, { credentialed: true, onboardedAt: 1 })).not.toThrow();
});

test("ensureCredentialed throws NotCredentialedError (errorCode NOT_CREDENTIALED) for undefined/false", () => {
  expect(() => ensureCredentialed(G, undefined)).toThrow(NotCredentialedError);
  try {
    ensureCredentialed(G, { credentialed: false });
    throw new Error("should have thrown");
  } catch (e) {
    expect(e).toBeInstanceOf(NotCredentialedError);
    expect((e as NotCredentialedError).errorCode).toBe("NOT_CREDENTIALED");
  }
});
```

- [ ] **Step 2: Run the test — confirm it fails (red).**

```bash
cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun test lib/carrier-gate.test.ts
```

Expected: a resolution/module error because `./carrier-gate` does not exist yet, e.g. `error: Cannot find module './carrier-gate'` — the run exits non-zero. This is the red state.

- [ ] **Step 3: Create the pure gate module `dashboard/lib/carrier-gate.ts` (green).** Depends only on Task 1 types; deliberately lives under `lib/` (not `lib/server/`) with no `"server-only"` so it stays unit-testable and importable from either side.

```ts
/**
 * dashboard/lib/carrier-gate.ts — pure carrier-credential gate helpers.
 *
 * No server deps and no `"server-only"`: this holds only the credential-gate
 * DECISION (used by flows.ts server-side) and address-shape validation, so it
 * is unit-testable in isolation (carrier-gate.test.ts). The store-backed,
 * async onboarding/status flows live in lib/server/flows.ts.
 */

import type { CarrierStatus } from "./types";

/** Stellar ed25519 public key: literal 'G' + 55 base32 chars (RFC 4648 alphabet). */
export function isValidStellarAddress(addr: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(addr);
}

/** Client-detectable tag for the credential-gate rejection. */
export const NOT_CREDENTIALED = "NOT_CREDENTIALED" as const;

/**
 * Structured credential-gate rejection. Routes `fail()` it into
 * `errorCode: "NOT_CREDENTIALED"`, which the /market UI keys on to show a
 * "Become a carrier" onboarding prompt instead of a generic error (spec §12).
 */
export class NotCredentialedError extends Error {
  readonly errorCode = NOT_CREDENTIALED;
  constructor(address: string) {
    super(
      `carrier ${address} is not credentialed — onboard first via POST /api/carrier/onboard`,
    );
    this.name = "NotCredentialedError";
  }
}

/** Pure gate decision: throw NotCredentialedError unless `status` is credentialed. */
export function ensureCredentialed(
  address: string,
  status: CarrierStatus | undefined,
): void {
  if (!status || !status.credentialed) throw new NotCredentialedError(address);
}
```

- [ ] **Step 4: Re-run the test — confirm it passes (green).**

```bash
cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun test lib/carrier-gate.test.ts
```

Expected: all pass, e.g. `4 pass`, `0 fail`, exit 0.

- [ ] **Step 5: Extend `fail()` in `flows.ts` to surface `.errorCode`.** So `NotCredentialedError` reaches the client as a tagged code. Additive — the Soroban `#n` fallback is unchanged. In `dashboard/lib/server/flows.ts`, replace the existing `fail`:

```ts
export function fail(e: unknown): { ok: false; error: string; errorCode?: string } {
  const error = e instanceof Error ? e.message : String(e);
  const m = /#(\d+)\b/.exec(error);
  return { ok: false, error, errorCode: m ? `Error(Contract, #${m[1]})` : undefined };
}
```

with:

```ts
export function fail(e: unknown): { ok: false; error: string; errorCode?: string } {
  const error = e instanceof Error ? e.message : String(e);
  // Prefer an explicit `errorCode` tag on the thrown error (e.g. NotCredentialedError
  // → "NOT_CREDENTIALED", so the client can render the onboarding prompt); otherwise
  // fall back to a parsed Soroban `Error(Contract, #n)` code.
  const tagged =
    e && typeof e === "object" && "errorCode" in e
      ? String((e as { errorCode: unknown }).errorCode)
      : undefined;
  const m = /#(\d+)\b/.exec(error);
  return { ok: false, error, errorCode: tagged ?? (m ? `Error(Contract, #${m[1]})` : undefined) };
}
```

- [ ] **Step 6: Add the carrier-gate import + `CarrierStatus`/`Reputation` types to `flows.ts`.** In `dashboard/lib/server/flows.ts`, in the existing `import type { … } from "../types";` block add `CarrierStatus,` and `Reputation,` to the list. Then, immediately **after** that `from "../types";` import block, add:

```ts
import { ensureCredentialed, isValidStellarAddress } from "../carrier-gate";
export { NotCredentialedError } from "../carrier-gate"; // re-export for routes + Task 5
```

- [ ] **Step 7: Append the onboarding + gate + status flows to `flows.ts`.** Add at the end of `dashboard/lib/server/flows.ts` (after `recordSettleFlow`):

```ts
// ── carrier onboarding + credential gate (Spec 1 marketplace) ────────────────

/**
 * Gate for the /market claim path (Task 5 marketClaimFlow): throw
 * NotCredentialedError unless `address` is a credentialed carrier in the shared
 * store. The route catches it and `fail()` tags errorCode="NOT_CREDENTIALED" so
 * the client shows a "Become a carrier" prompt (spec §12) rather than the packet.
 */
export async function assertCarrierCredentialed(address: string): Promise<void> {
  ensureCredentialed(address, await store.getCarrier(address));
}

/**
 * Onboard a carrier: mark `address` credentialed so it can claim from /market.
 * Idempotent — re-onboarding a credentialed carrier preserves its onboardedAt.
 *
 * PONYTAIL — demo shortcut, stated honestly. A REAL credential issuance builds
 * the depth-10 credential tree with this carrier's leaf
 *   leaf = Poseidon(DOM_CRED, pk_x, pk_y, class, payload_limit_g, expiry_ts)   (DESIGN §6.3)
 * and publishes the new epoch root via aegis-credentials `set_root(root, epoch)`,
 * which is gated by `issuer.require_auth()` (DESIGN §10.3). This server holds NO
 * Stellar signing key — least of all the issuer's — so it CANNOT sign that tx;
 * spec §13 flags this exact "credential issuance needs an admin/authorized
 * signer" risk. For the demo we record credentialed=true in the shared store and
 * leave the on-chain root untouched. `accept` still succeeds because plan-001
 * `accept` takes the A3 credential proof as OPTIONAL (DESIGN §8.2: "Without A3,
 * accept is an authorized plain call"). Real issuance is roadmap: an
 * issuer-key-holding service publishes the root out-of-band.
 */
export async function onboardCarrierFlow(address: string): Promise<CarrierStatus> {
  if (!isValidStellarAddress(address)) throw new Error("invalid Stellar address");
  const existing = await store.getCarrier(address);
  if (existing.credentialed) return existing; // idempotent — keep original onboardedAt
  await store.setCarrierCredentialed(address, Math.floor(Date.now() / 1000));
  return store.getCarrier(address);
}

/** Carrier status for GET /api/carrier/<address>: credential flag + reputation. */
export async function carrierStatusFlow(
  address: string,
): Promise<{ credentialed: boolean; onboardedAt?: number; reputation: Reputation }> {
  if (!isValidStellarAddress(address)) throw new Error("invalid Stellar address");
  const [status, reputation] = await Promise.all([
    store.getCarrier(address),
    store.getRep(address),
  ]);
  return { credentialed: status.credentialed, onboardedAt: status.onboardedAt, reputation };
}
```

- [ ] **Step 8: Create `dashboard/app/api/carrier/onboard/route.ts`.** Mirrors the `recipient-pod`/`faucet` route shape exactly.

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { onboardCarrierFlow, ok, fail } from "@/lib/server/flows";

// POST /api/carrier/onboard { address } → ActionResult<CarrierStatus>
// Marks a carrier credentialed so it can claim from /market. Demo shortcut — see
// onboardCarrierFlow's ponytail note: real leaf issuance needs the issuer's
// Stellar key (aegis-credentials.set_root), which this key-less server lacks.
export async function POST(req: Request) {
  try {
    const { address } = (await req.json()) as { address?: string };
    if (!address) throw new Error("address required");
    return NextResponse.json(ok(await onboardCarrierFlow(address)));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
```

- [ ] **Step 9: Create `dashboard/app/api/carrier/[address]/route.ts`.** Next 16 delivers `params` as a Promise, so it is awaited. The dynamic `[address]` segment coexists with the static `verify/` and `onboard/` siblings — Next resolves static segments first, so `/api/carrier/verify` and `/api/carrier/onboard` are unaffected.

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { carrierStatusFlow, ok, fail } from "@/lib/server/flows";

// GET /api/carrier/<address> → ActionResult<{ credentialed, onboardedAt?, reputation }>
export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;
    return NextResponse.json(ok(await carrierStatusFlow(address)));
  } catch (e) {
    return NextResponse.json(fail(e));
  }
}
```

- [ ] **Step 10: Typecheck + lint (both exit 0).**

```bash
cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bunx tsc --noEmit && bun run lint
```

Expected: `tsc` prints nothing and exits 0; `bun run lint` reports no errors (warnings tolerated) and exits 0. (If `tsc` errors on `CarrierStatus`/`Reputation` or `store.getCarrier/getRep/setCarrierCredentialed`, Task 1 types / Task 2 store are not landed yet — those are this task's declared upstream deps.)

- [ ] **Step 11: Production build (exit 0).**

```bash
cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun run build
```

Expected: build completes, exit 0. In the route manifest you should see `ƒ /api/carrier/onboard` and `ƒ /api/carrier/[address]` listed as dynamic (server) routes.

- [ ] **Step 12: Runtime check — start the built server and curl onboard → status.** Uses the in-memory KV fallback (no `KV_REST_API_URL` in dev); the module-scope Map persists across requests within the one server process, so onboard is visible to the follow-up status read.

```bash
cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && (bun run start -- -p 3008 >/tmp/aegis-8.log 2>&1 &) ; sleep 5
A=GC5Z644P4L2WUHLAK37KAO6OWF6NH3DUIH3Y5EVOQWHQ2BSHBBCE4NWN   # demo carrier
B=GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA   # fresh, never onboarded
echo "--- onboard A ---"; curl -s -X POST localhost:3008/api/carrier/onboard -H 'content-type: application/json' -d "{\"address\":\"$A\"}"; echo
echo "--- status A ---";  curl -s "localhost:3008/api/carrier/$A"; echo
echo "--- status B ---";  curl -s "localhost:3008/api/carrier/$B"; echo
echo "--- invalid ---";   curl -s "localhost:3008/api/carrier/not-an-address"; echo
pkill -f "next start -p 3008" || pkill -f "next-server"
```

Expected (numbers/timestamps will vary):
```
--- onboard A --- {"ok":true,"data":{"credentialed":true,"onboardedAt":1751500000}}
--- status A ---  {"ok":true,"data":{"credentialed":true,"onboardedAt":1751500000,"reputation":{"delivered":0,"expired":0}}}
--- status B ---  {"ok":true,"data":{"credentialed":false,"reputation":{"delivered":0,"expired":0}}}
--- invalid ---   {"ok":false,"error":"invalid Stellar address"}
```
(`onboardedAt` is omitted from status B because it is `undefined`; JSON drops it.)

- [ ] **Step 13: Integration check — the gate wired into Task 5's `/market` claim (do once Task 5 is present).** `marketClaimFlow` awaits `assertCarrierCredentialed(carrierAddress)` before releasing the sealed packet. With the server from Step 12 still up (and an open listing id from Task 3/4):

```bash
# Non-credentialed wallet B → gate rejects with the onboarding tag:
curl -s -X POST localhost:3008/api/market -H 'content-type: application/json' \
  -d '{"shipmentId":<OPEN_ID>,"source":"GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA"}'; echo
# → {"ok":false,"error":"carrier GA7…UWDA is not credentialed — onboard first via POST /api/carrier/onboard","errorCode":"NOT_CREDENTIALED"}

# After onboarding B (or using the pre-seeded carrier A), the same claim returns the packet:
curl -s -X POST localhost:3008/api/carrier/onboard -H 'content-type: application/json' \
  -d '{"address":"GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA"}'; echo
curl -s -X POST localhost:3008/api/market -H 'content-type: application/json' \
  -d '{"shipmentId":<OPEN_ID>,"source":"GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA"}'; echo
# → {"ok":true,"data":{"packet":{…}}}
```

Expected: first call carries `"errorCode":"NOT_CREDENTIALED"`; the post-onboard call returns `"ok":true` with the sealed packet. (If Task 5 is not yet merged, skip this step — Steps 1–12 fully verify Task 8's own surface. To satisfy spec §159 "pre-seed one demo carrier," call `POST /api/carrier/onboard` for the demo carrier address once at seed time, or add it to the Task 2 store seed.)

- [ ] **Step 14: Commit.**

```bash
cd /Users/dadadave/Dev/Stellar/aegis-relay && git add dashboard/lib/carrier-gate.ts dashboard/lib/carrier-gate.test.ts dashboard/lib/server/flows.ts dashboard/app/api/carrier/onboard/route.ts "dashboard/app/api/carrier/[address]/route.ts" && git commit -m "feat(market): carrier onboarding + credential gate

- POST /api/carrier/onboard marks a wallet credentialed (KV); GET /api/carrier/<address> returns credential + reputation
- pure carrier-gate (isValidStellarAddress, ensureCredentialed, NotCredentialedError) with bun:test
- assertCarrierCredentialed gate consumed by marketClaimFlow; fail() surfaces errorCode NOT_CREDENTIALED for the onboarding prompt
- ponytail: on-chain leaf issuance needs the issuer's Stellar key (aegis-credentials.set_root) which the key-less server lacks; demo records credentialed=true and relies on optional A3 at accept (DESIGN 6.3/8.2/10.3, spec 13)"
```


### Task 9: Reputation counters + display

**Files:**
- `dashboard/lib/rep.ts` — *new*, pure reputation math + display summary (no directive; shared server/client, like `Stamp`).
- `dashboard/lib/rep.test.ts` — *new*, `bun:test` for the bump math (TDD).
- `dashboard/components/ds/RepChip.tsx` — *new*, DS presentational chip from a `Reputation`.
- `dashboard/components/market/CarrierRep.tsx` — *new*, `"use client"` self-fetching wrapper (`GET /api/carrier/<address>` → `RepChip`).
- `dashboard/lib/server/flows.ts` — *edit*, bump rep on terminal transitions in `submitAction`.
- `dashboard/components/console/RolePanels.tsx` — *edit*, carrier-console rep chip.
- `dashboard/app/market/page.tsx` — *edit* (Task 7's file), rep chip on board header + claimed rows.

**Interfaces:**
- **Consumes** (Task 2 store rep accessors, imported via `import * as store` already present in flows.ts):
  - `store.bumpRep(address: string, kind: "delivered" | "expired"): Promise<void>`
  - `store.getRep(address: string): Promise<Reputation>` (returns zeroed `{delivered:0,expired:0}` for unknown addresses)
- **Consumes** (Task 8): `GET /api/carrier/<address>` → `{ ok, data: { credentialed: boolean; reputation: Reputation } }`.
- **Consumes** (types task): `Reputation { delivered: number; expired: number }` from `@/lib/types`.
- **Produces:**
  - `emptyRep(): Reputation`
  - `applyRepBump(rep: Reputation, kind: "delivered" | "expired"): Reputation` (pure, non-mutating — the canonical increment `store.bumpRep` persists)
  - `repSummary(rep: Reputation): RepSummary` where `RepSummary { delivered: number; expired: number; total: number; rate: number; pct: number; fresh: boolean; tier: "new"|"poor"|"fair"|"good" }`
  - `<RepChip rep={rep} style?={...} />`, `<CarrierRep address={address} />`

---

- [ ] **Step 1: Confirm prerequisites (grep, ~2 min).** The store accessors (Task 2) and the `Reputation` type must exist before wiring. Run:
  ```bash
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && \
    grep -n "export interface Reputation" lib/types.ts ; \
    grep -nE "export async function (bumpRep|getRep)" lib/server/store.ts
  ```
  Expected: one `Reputation` line and both `bumpRep` / `getRep` lines. If `Reputation` is missing (types task not yet landed), add it verbatim to `lib/types.ts` so this task typechecks:
  ```ts
  export interface Reputation { delivered: number; expired: number }
  ```
  If `bumpRep`/`getRep` are missing, stop — Task 2 is a hard dependency.

- [ ] **Step 2: TDD red — write the failing math test (~4 min).** Create `dashboard/lib/rep.test.ts`:
  ```ts
  import { test, expect } from "bun:test";
  import { emptyRep, applyRepBump, repSummary } from "./rep";

  test("emptyRep starts at zero", () => {
    expect(emptyRep()).toEqual({ delivered: 0, expired: 0 });
  });

  test("applyRepBump('delivered') increments only delivered", () => {
    expect(applyRepBump({ delivered: 2, expired: 1 }, "delivered")).toEqual({ delivered: 3, expired: 1 });
  });

  test("applyRepBump('expired') increments only expired", () => {
    expect(applyRepBump({ delivered: 2, expired: 1 }, "expired")).toEqual({ delivered: 2, expired: 2 });
  });

  test("applyRepBump is pure (does not mutate input)", () => {
    const rep = { delivered: 5, expired: 0 };
    applyRepBump(rep, "expired");
    expect(rep).toEqual({ delivered: 5, expired: 0 });
  });

  test("applyRepBump composes over a full history", () => {
    let r = emptyRep();
    for (const k of ["delivered", "delivered", "expired", "delivered"] as const) r = applyRepBump(r, k);
    expect(r).toEqual({ delivered: 3, expired: 1 });
  });

  test("repSummary on empty history is fresh/new with zero rate", () => {
    const s = repSummary({ delivered: 0, expired: 0 });
    expect(s.total).toBe(0);
    expect(s.fresh).toBe(true);
    expect(s.pct).toBe(0);
    expect(s.tier).toBe("new");
  });

  test("repSummary computes success rate + pct", () => {
    const s = repSummary({ delivered: 3, expired: 1 });
    expect(s.total).toBe(4);
    expect(s.rate).toBeCloseTo(0.75, 5);
    expect(s.pct).toBe(75);
    expect(s.fresh).toBe(false);
    expect(s.tier).toBe("fair");
  });

  test("repSummary tiers: good >=90, fair >=60, poor <60", () => {
    expect(repSummary({ delivered: 9, expired: 1 }).tier).toBe("good"); // 90%
    expect(repSummary({ delivered: 6, expired: 4 }).tier).toBe("fair"); // 60%
    expect(repSummary({ delivered: 1, expired: 4 }).tier).toBe("poor"); // 20%
  });

  test("repSummary sanitizes negative / fractional counters", () => {
    const s = repSummary({ delivered: -3, expired: 2.9 });
    expect(s.delivered).toBe(0);
    expect(s.expired).toBe(2);
    expect(s.total).toBe(2);
  });
  ```
  Run:
  ```bash
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun test lib/rep.test.ts
  ```
  Expected: it fails to resolve — `error: Cannot find module './rep'` (red). This proves the test runs before the impl exists.

- [ ] **Step 3: TDD green — write the math module (~4 min).** Create `dashboard/lib/rep.ts`:
  ```ts
  // Pure reputation math + display derivation. Shared (no "use client"/"server-only"),
  // like components/ds/Stamp — imported by the store-fed chip AND mirrored by the
  // server's store.bumpRep. applyRepBump is THE canonical increment; keeping it here
  // (not inline in the store) makes the "delivered vs expired" rule test-covered once.
  import type { Reputation } from "./types";

  /** Zero reputation — a carrier with no terminal history yet. */
  export function emptyRep(): Reputation {
    return { delivered: 0, expired: 0 };
  }

  /**
   * Canonical reputation increment. A terminal DELIVERED (settle) bumps `delivered`;
   * a terminal EXPIRED (refund-on-deadline) bumps `expired`. Pure — returns a fresh
   * object, never mutates. store.bumpRep persists exactly this transition.
   */
  export function applyRepBump(rep: Reputation, kind: "delivered" | "expired"): Reputation {
    return kind === "delivered"
      ? { delivered: rep.delivered + 1, expired: rep.expired }
      : { delivered: rep.delivered, expired: rep.expired + 1 };
  }

  export interface RepSummary {
    delivered: number;
    expired: number;
    total: number;
    /** Success rate in [0,1]; 0 when there is no history yet. */
    rate: number;
    /** Whole-percent success rate for display (0 when no history). */
    pct: number;
    /** true when the carrier has zero terminal history. */
    fresh: boolean;
    /** Coarse standing bucket that drives the chip tone. */
    tier: "new" | "poor" | "fair" | "good";
  }

  /** Derive the display summary from raw counters. Pure; tolerant of dirty input. */
  export function repSummary(rep: Reputation): RepSummary {
    const delivered = Math.max(0, Math.floor(rep.delivered));
    const expired = Math.max(0, Math.floor(rep.expired));
    const total = delivered + expired;
    const rate = total === 0 ? 0 : delivered / total;
    const pct = Math.round(rate * 100);
    const fresh = total === 0;
    const tier: RepSummary["tier"] = fresh ? "new" : pct >= 90 ? "good" : pct >= 60 ? "fair" : "poor";
    return { delivered, expired, total, rate, pct, fresh, tier };
  }
  ```
  Re-run:
  ```bash
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun test lib/rep.test.ts
  ```
  Expected: `9 pass, 0 fail` (green).

- [ ] **Step 4: Create the DS chip (~4 min).** Create `dashboard/components/ds/RepChip.tsx` — reuses `Stamp` + CSS vars, no client hooks (renders in either tree, like `Stamp`):
  ```tsx
  import type { CSSProperties } from "react";
  import type { Reputation } from "@/lib/types";
  import { repSummary } from "@/lib/rep";
  import { Stamp } from "./Stamp";

  const TIER_COLOR: Record<"new" | "poor" | "fair" | "good", string> = {
    new: "var(--ink-dim)",
    poor: "var(--danger)",
    fair: "var(--caution)",
    good: "var(--verified)",
  };

  /**
   * <RepChip> — carrier reputation as a compact instrument chip (Aegis Relay DS).
   * Success-rate tier from delivered/expired counters; monospace numerals, hairline
   * border, tier-colored value. "NEW" for a carrier with no terminal history yet.
   */
  export function RepChip({ rep, style }: { rep: Reputation; style?: CSSProperties }) {
    const s = repSummary(rep);
    return (
      <span
        className="mono"
        title={`${s.delivered} delivered · ${s.expired} expired`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 8px",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--r-control)",
          fontSize: "var(--text-xs)",
          background: "var(--void-0)",
          whiteSpace: "nowrap",
          ...style,
        }}
      >
        <Stamp tone="dim">REP</Stamp>
        <span style={{ color: TIER_COLOR[s.tier] }}>
          {s.fresh ? "NEW" : `${s.pct}% · ${s.delivered}/${s.total}`}
        </span>
      </span>
    );
  }
  ```

- [ ] **Step 5: Create the self-fetching wrapper (~4 min).** Create `dashboard/components/market/CarrierRep.tsx`. Direct fetch (mirrors the `{ok,error,data}` envelope, never throws) so it stays decoupled from Task 8's `lib/api.ts` additions and builds in isolation:
  ```tsx
  "use client";
  import { useEffect, useState } from "react";
  import type { Reputation } from "@/lib/types";
  import { RepChip } from "@/components/ds/RepChip";

  /** GET /api/carrier/<address> payload (Task 8) — read-only view of the wire shape. */
  interface CarrierApiData {
    credentialed: boolean;
    reputation: Reputation;
  }
  interface Envelope<T> {
    ok: boolean;
    error?: string;
    data?: T;
  }

  /**
   * <CarrierRep> — self-fetching reputation chip for a carrier address. Reads
   * GET /api/carrier/<address> and renders <RepChip>. Drop-in for the /market board
   * (header standing + claimed rows) and the carrier console. Best-effort: renders
   * nothing until data arrives, and nothing on error (a missing chip never breaks a row).
   */
  export function CarrierRep({ address }: { address: string }) {
    const [rep, setRep] = useState<Reputation | null>(null);
    useEffect(() => {
      let live = true;
      (async () => {
        try {
          const r = await fetch(`/api/carrier/${encodeURIComponent(address)}`);
          const body = (await r.json()) as Envelope<CarrierApiData>;
          if (live && body.ok && body.data) setRep(body.data.reputation);
        } catch {
          /* board chips are best-effort */
        }
      })();
      return () => {
        live = false;
      };
    }, [address]);
    if (!rep) return null;
    return <RepChip rep={rep} />;
  }
  ```

- [ ] **Step 6: Wire the bump into terminal transitions (~4 min).** In `dashboard/lib/server/flows.ts`, the tail of `submitAction` (around line 393). Replace:
  ```ts
    store.delPending(req.buildId);
    const view = shipmentId !== undefined ? await shipmentView(shipmentId) : undefined;
    return { tx: res.hash, shipmentId, view };
  ```
  with:
  ```ts
    store.delPending(req.buildId);
    const view = shipmentId !== undefined ? await shipmentView(shipmentId) : undefined;

    // Reputation sync on terminal transitions (Task 9). A DELIVERED settle credits
    // the payout carrier; an EXPIRED refund debits the carrier that accepted but let
    // the deadline pass. A never-accepted shipment that expires has no payout → no-op.
    // Gated on the freshly-read on-chain state so a bump only lands when the transition
    // actually occurred (the tx submitted above).
    if (view?.payout) {
      if (pend.action === "deliver" && view.state === "DELIVERED") {
        await store.bumpRep(view.payout, "delivered");
      } else if (pend.action === "refund" && view.state === "EXPIRED") {
        await store.bumpRep(view.payout, "expired");
      }
    }

    return { tx: res.hash, shipmentId, view };
  ```
  (`store` is already `import * as store from "./store"`; `view.payout`/`view.state` come off the pinned `ShipmentView`.)

- [ ] **Step 7: Show the chip on the carrier console (~3 min).** In `dashboard/components/console/RolePanels.tsx`, add the import after the `useWalletFlows` import — replace:
  ```ts
  import { useWalletFlows } from "@/lib/wallet-flows";
  import { useToast } from "./toast";
  ```
  with:
  ```ts
  import { useWalletFlows } from "@/lib/wallet-flows";
  import { CarrierRep } from "@/components/market/CarrierRep";
  import { useToast } from "./toast";
  ```
  Then in `CarrierPanel`'s returned `<Panel>` body, render the connected carrier's own standing. Replace:
  ```tsx
        {!walletReady && <NeedWallet />}
        {error && <InlineError title={error.title} detail={error.detail} />}
  ```
  with:
  ```tsx
        {!walletReady && <NeedWallet />}
        {stellarAddress && (
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 0 6px" }}>
            <CarrierRep address={stellarAddress} />
          </div>
        )}
        {error && <InlineError title={error.title} detail={error.detail} />}
  ```
  (`stellarAddress` is already destructured from `useWallet()` at the top of `CarrierPanel`; the `stellarAddress &&` guard narrows it to `string`.)

- [ ] **Step 8: Show the chip on the /market board (~4 min).** In `dashboard/app/market/page.tsx` (Task 7's client page), add near the other imports:
  ```tsx
  import { CarrierRep } from "@/components/market/CarrierRep";
  ```
  Render the viewing carrier's standing in the board header/toolbar (use Task 7's connected-address variable — the board reads `useWallet().stellarAddress`; call it `myAddress` below):
  ```tsx
  {myAddress && (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span className="honesty" style={{ color: "var(--ink-dim)" }}>your standing</span>
      <CarrierRep address={myAddress} />
    </span>
  )}
  ```
  And in the per-listing row markup, next to where the row shows its carrier/payout, show that carrier's rep for already-claimed rows (OPEN rows have no carrier, so nothing renders):
  ```tsx
  {listing.payout && <CarrierRep address={listing.payout} />}
  ```
  (`listing.payout?: string` is on the shared `Listing` type; `CarrierRep` returns `null` for OPEN/unclaimed or while loading, so it is safe to drop into any row.)

- [ ] **Step 9: Static gates (~4 min).** Run all three; each must exit 0:
  ```bash
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bunx tsc --noEmit && echo "TSC_OK"
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun run lint && echo "LINT_OK"
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard && bun run build && echo "BUILD_OK"
  ```
  Expected: `TSC_OK`, `LINT_OK`, and `BUILD_OK` (build ends with `Compiled successfully`). Fix any type/lint error before proceeding.

- [ ] **Step 10: Runtime check (~4 min).** Serve the build and confirm the data feed + the board route. Set `ADDR` to the pre-seeded demo carrier's G-address (Task 8 onboarding); any valid G-address works — unknown ones return zeroed rep, so the chip shows `NEW`:
  ```bash
  cd /Users/dadadave/Dev/Stellar/aegis-relay/dashboard
  (bun run start -- -p 3011 &) ; sleep 6
  ADDR="<pre-seeded demo carrier G-address>"
  curl -s "http://localhost:3011/api/carrier/${ADDR}" | grep -o '"reputation":{[^}]*}'
  curl -s -o /dev/null -w "market=%{http_code}\n" "http://localhost:3011/market"
  ```
  Expected: the first curl prints `"reputation":{"delivered":0,"expired":0}` (the exact shape `RepChip` consumes), and `market=200`. Note: `CarrierRep` mounts client-side after fetch, so the chip itself renders in the browser (final visual confirm belongs to the spec §11 funded-wallet E2E: after a real `deliver`, the carrier's chip ticks `delivered`; after a `refund_expired`, `expired`). Stop the server: `kill %1 2>/dev/null || pkill -f "next start -p 3011"`.

- [ ] **Step 11: Commit (~2 min).**
  ```bash
  cd /Users/dadadave/Dev/Stellar/aegis-relay && \
    git add dashboard/lib/rep.ts dashboard/lib/rep.test.ts \
      dashboard/components/ds/RepChip.tsx dashboard/components/market/CarrierRep.tsx \
      dashboard/lib/server/flows.ts dashboard/components/console/RolePanels.tsx \
      dashboard/app/market/page.tsx dashboard/lib/types.ts && \
    git commit -m "feat(market): reputation counters on terminal transitions + rep chip on board & carrier console"
  ```
  Expected: one commit; `git status` clean. (Drop `dashboard/lib/types.ts` from the `git add` if Step 1 did not modify it.)


### Task 10: Thin disputes — refund action + report flag (RolePanels.tsx, flows.ts)

**Files:**
- `dashboard/lib/disputes.ts` (new, pure helpers)
- `dashboard/lib/disputes.test.ts` (new, `bun:test`)
- `dashboard/lib/server/store.ts` (edit: add `ShipReport` + `report?` on `ShipRecord`)
- `dashboard/lib/server/flows.ts` (edit: add `reportShipFlow`)
- `dashboard/lib/types.ts` (edit: add `ReportReq` / `ReportRes`)
- `dashboard/lib/api.ts` (edit: add `api.report`)
- `dashboard/app/api/dispute/report/route.ts` (new)
- `dashboard/components/console/RolePanels.tsx` (edit: `MerchantDisputes` section)

**Interfaces:**
- Consumes: `useWalletFlows().refund(shipmentId): Promise<ActionResult<SubmitTxRes>>` (wraps `buildRefund` → `refund_expired`, already wired); `store.getShip(id)` / `store.updateShip(id, patch)` (Task 2 — now async; await both); `ShipmentView` (`state`, `escrowDeadline` number).
- Produces:
  - `refundEligibility(view: ShipmentView | null, nowSec: number): RefundEligibility` where `RefundEligibility = { kind: "eligible" } | { kind: "before-deadline"; secondsRemaining: number } | { kind: "already-expired" } | { kind: "not-refundable" }`
  - `fmtRemaining(sec: number): string`
  - `reportShipFlow(id: number, reason: string): Promise<{ reported: boolean; at: number }>`
  - `ReportReq { shipmentId: number; reason: string }`, `ReportRes { reported: boolean; at: number }`
  - `api.report(b: ReportReq): Promise<ActionResult<ReportRes>>`
  - store: `ShipReport { reason: string; at: number }`, `ShipRecord.report?: ShipReport`

Refund gating mirrors the contract (`refund_expired`, `contracts/aegis-registry/src/lib.rs:874`): legal only from `Open`/`InTransit` and strictly `timestamp > escrow_deadline` (else `DeadlineNotPassed`); once refunded the state is `Expired`.

---

- [ ] **Step 1: Failing test for the pure eligibility helpers (TDD red).**
  Create `dashboard/lib/disputes.test.ts`:
  ```ts
  import { test, expect } from "bun:test";
  import { refundEligibility, fmtRemaining } from "./disputes";
  import type { ShipmentView } from "./types";

  function view(p: Partial<ShipmentView>): ShipmentView {
    return {
      id: 1, state: "OPEN", method: "courier", rail: "transparent",
      laneId: null, cs: "0", head: null, amountXlm: "25", paidXlm: "0",
      flightOk: false, escrowDeadline: 1000, payout: null, ...p,
    };
  }

  test("null view is not refundable", () => {
    expect(refundEligibility(null, 2000).kind).toBe("not-refundable");
  });
  test("OPEN past deadline is eligible", () => {
    expect(refundEligibility(view({ state: "OPEN", escrowDeadline: 1000 }), 2000)).toEqual({ kind: "eligible" });
  });
  test("IN_TRANSIT past deadline is eligible", () => {
    expect(refundEligibility(view({ state: "IN_TRANSIT", escrowDeadline: 1000 }), 2000).kind).toBe("eligible");
  });
  test("OPEN before deadline reports remaining seconds", () => {
    expect(refundEligibility(view({ state: "OPEN", escrowDeadline: 5000 }), 2000)).toEqual({ kind: "before-deadline", secondsRemaining: 3000 });
  });
  test("boundary: exactly at deadline is not yet eligible (contract uses strict >)", () => {
    expect(refundEligibility(view({ state: "OPEN", escrowDeadline: 2000 }), 2000).kind).toBe("before-deadline");
  });
  test("EXPIRED is already-expired", () => {
    expect(refundEligibility(view({ state: "EXPIRED" }), 2000).kind).toBe("already-expired");
  });
  test("DELIVERED is not refundable", () => {
    expect(refundEligibility(view({ state: "DELIVERED" }), 2000).kind).toBe("not-refundable");
  });
  test("UNKNOWN is not refundable", () => {
    expect(refundEligibility(view({ state: "UNKNOWN" }), 9999).kind).toBe("not-refundable");
  });
  test("fmtRemaining formats h/m/s", () => {
    expect(fmtRemaining(3720)).toBe("1h 2m");
    expect(fmtRemaining(120)).toBe("2m");
    expect(fmtRemaining(45)).toBe("45s");
    expect(fmtRemaining(0)).toBe("now");
  });
  ```
  Run:
  ```
  cd dashboard && bun test lib/disputes.test.ts
  ```
  Expected: fails to resolve `./disputes` (module not found) — red.

- [ ] **Step 2: Create the pure helpers (TDD green).**
  Create `dashboard/lib/disputes.ts` (no `"use client"` — pure, importable by both the client panel and `bun:test`):
  ```ts
  // Pure disputes logic — refund eligibility mirrors the registry's refund_expired
  // gate (Open/InTransit + strict timestamp > escrow_deadline). No React, no server
  // deps, so it unit-tests headless and reuses between the panel and any future SSR.
  import type { ShipmentView } from "./types";

  export type RefundEligibility =
    | { kind: "eligible" }
    | { kind: "before-deadline"; secondsRemaining: number }
    | { kind: "already-expired" }
    | { kind: "not-refundable" };

  export function refundEligibility(
    view: ShipmentView | null,
    nowSec: number,
  ): RefundEligibility {
    if (!view) return { kind: "not-refundable" };
    if (view.state === "EXPIRED") return { kind: "already-expired" };
    if (view.state !== "OPEN" && view.state !== "IN_TRANSIT") {
      return { kind: "not-refundable" };
    }
    // Contract rejects timestamp <= escrow_deadline (DeadlineNotPassed): strict >.
    if (nowSec > view.escrowDeadline) return { kind: "eligible" };
    return { kind: "before-deadline", secondsRemaining: view.escrowDeadline - nowSec };
  }

  export function fmtRemaining(sec: number): string {
    if (sec <= 0) return "now";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${sec}s`;
  }
  ```
  Run:
  ```
  cd dashboard && bun test lib/disputes.test.ts
  ```
  Expected: `10 pass, 0 fail` — green.

- [ ] **Step 3: Add the report flag to the mailbox record (`store.ts`).**
  In `dashboard/lib/server/store.ts`, add the `ShipReport` interface immediately **before** `export interface ShipRecord {`:
  ```ts
  /** Thin-dispute flag written to ship:<id> (§8 disputes). Never a Stellar tx. */
  export interface ShipReport {
    reason: string;
    at: number; // Date.now() when filed
  }

  ```
  Then extend `ShipRecord` — replace:
  ```ts
    settleTx?: string;
  }
  ```
  with:
  ```ts
    settleTx?: string;
    /** Thin-dispute report flag (§8). Set by reportShipFlow; never on-chain. */
    report?: ShipReport;
  }
  ```
  (Anchors match the current `store.ts`; Task 2 keeps the `ShipRecord` shape but makes `getShip`/`updateShip` async — await them per Global Constraints.)

- [ ] **Step 4: Add `reportShipFlow` to `flows.ts`.**
  In `dashboard/lib/server/flows.ts`, append at the end of the file (after `recordSettleFlow`):
  ```ts

  // ── thin disputes — report flag on ship:<id> (§8) ────────────────────────────

  /** Set a lightweight report flag on the shipment's mailbox record. No on-chain
   *  effect — deep arbitration is a follow-on spec. Requires an existing record. */
  export async function reportShipFlow(
    id: number,
    reason: string,
  ): Promise<{ reported: boolean; at: number }> {
    const rec = store.getShip(id);
    if (!rec) throw new Error(`no stored record for shipment ${id}`);
    const trimmed = (reason ?? "").trim().slice(0, 500);
    if (!trimmed) throw new Error("a report reason is required");
    const at = Date.now();
    store.updateShip(id, { report: { reason: trimmed, at } });
    return { reported: true, at };
  }
  ```
  (`store.updateShip` is called synchronously to match every other call site in this file.)

- [ ] **Step 5: Add the request/response shapes (`types.ts`).**
  In `dashboard/lib/types.ts`, add after the `SignPodReq` line:
  ```ts

  /** POST /api/dispute/report — file a thin-dispute flag on ship:<id> (§8). */
  export interface ReportReq { shipmentId: number; reason: string; }
  export interface ReportRes { reported: boolean; at: number; }
  ```

- [ ] **Step 6: Add the client fetch wrapper (`api.ts`).**
  In `dashboard/lib/api.ts`, add `ReportReq, ReportRes` to the `import type { … } from "./types";` block, then add this line to the `api` object right after the `audit:` entry:
  ```ts
    report:       (b: ReportReq)    => post<ReportRes>("/api/dispute/report", b),
  ```

- [ ] **Step 7: Create the route.**
  Create `dashboard/app/api/dispute/report/route.ts`:
  ```ts
  export const runtime = "nodejs";
  export const dynamic = "force-dynamic";

  import { NextResponse } from "next/server";
  import { reportShipFlow, ok, fail } from "@/lib/server/flows";
  import type { ReportReq } from "@/lib/types";

  export async function POST(req: Request) {
    try {
      const body = (await req.json()) as ReportReq;
      if (typeof body?.shipmentId !== "number") throw new Error("shipmentId is required");
      return NextResponse.json(ok(await reportShipFlow(body.shipmentId, body.reason)));
    } catch (e) {
      return NextResponse.json(fail(e));
    }
  }
  ```

- [ ] **Step 8: Wire the disputes surface into `MerchantPanel` (`RolePanels.tsx`).**
  Add the helper import after the existing `proveGroth16` import:
  ```ts
  import { refundEligibility, fmtRemaining } from "@/lib/disputes";
  ```
  Pull the focused shipment from the session — replace the `MerchantPanel` destructure:
  ```ts
    const {
      setCurrentShipmentId,
      setCreatedDest,
      applyView,
      refreshShipment,
    } = useSession();
  ```
  with:
  ```ts
    const {
      currentShipmentId,
      shipment,
      setCurrentShipmentId,
      setCreatedDest,
      applyView,
      refreshShipment,
    } = useSession();
  ```
  Then render the section — replace the closing drone-Honesty block:
  ```tsx
        {method === "drone" && (
          <Honesty>
            SIMULATED drone secure element — the proof binds a key, not physics.
          </Honesty>
        )}
      </Panel>
  ```
  with:
  ```tsx
        {method === "drone" && (
          <Honesty>
            SIMULATED drone secure element — the proof binds a key, not physics.
          </Honesty>
        )}

        {currentShipmentId !== null && shipment && (
          <div
            className="space-y-3"
            style={{ borderTop: "1px solid var(--hairline)", paddingTop: 20 }}
          >
            <SectionLabel>Disputes — shipment #{currentShipmentId}</SectionLabel>
            <MerchantDisputes shipmentId={currentShipmentId} view={shipment} />
          </div>
        )}
      </Panel>
  ```

- [ ] **Step 9: Add the `MerchantDisputes` component.**
  In `dashboard/components/console/RolePanels.tsx`, insert this component immediately **before** the `// ── Carrier ──` divider comment:
  ```tsx
  // ── Merchant disputes (thin) ─────────────────────────────────────────────────

  function MerchantDisputes({ shipmentId, view }: { shipmentId: number; view: ShipmentView }) {
    const { applyView, refreshShipment } = useSession();
    const { stellarAddress } = useWallet();
    const flows = useWalletFlows();
    const { toast } = useToast();
    const { runningKey, error, setError, run } = useRunner();
    const [reason, setReason] = useState("");
    const [reported, setReported] = useState(false);
    const walletReady = !!stellarAddress;

    const elig = refundEligibility(view, Math.floor(Date.now() / 1000));

    const refund = () =>
      run("refund", async () => {
        const res = await flows.refund(shipmentId);
        if (res.ok && res.data) {
          if (res.data.view) applyView(res.data.view);
          void refreshShipment();
          toast({
            title: "Escrow refunded",
            detail: "deadline passed — remaining escrow returned to the merchant",
          });
        } else setError({ title: "Refund failed", detail: res.error ?? "Unknown error" });
      });

    const report = () =>
      run("report", async () => {
        const res = await api.report({ shipmentId, reason });
        if (res.ok && res.data?.reported) {
          setReported(true);
          toast({ title: "Report filed", detail: `flagged shipment #${shipmentId} for review` });
        } else setError({ title: "Report failed", detail: res.error ?? "Unknown error" });
      });

    return (
      <div className="space-y-4">
        <p className="text-sm" style={{ color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
          If the deadline passes with no delivery, reclaim the escrowed payment. This
          wraps the registry&apos;s <span className="mono">refund_expired</span> — the
          remaining escrow always returns to the merchant.
        </p>

        {elig.kind === "eligible" && (
          <>
            {!walletReady && <NeedWallet />}
            <ActionButton
              variant="danger"
              onClick={refund}
              disabled={!walletReady}
              loading={runningKey === "refund"}
              loadingLabel="Signing refund…"
              className="w-full sm:w-auto"
            >
              Refund (deadline passed)
            </ActionButton>
          </>
        )}
        {elig.kind === "before-deadline" && (
          <Notice>
            Deadline in <span className="mono">{fmtRemaining(elig.secondsRemaining)}</span>.
            The refund unlocks only after it passes — the registry rejects an early
            call (<span className="mono">DeadlineNotPassed</span>).
          </Notice>
        )}
        {elig.kind === "already-expired" && (
          <Result tone="caution">
            Already expired — the remaining escrow has been returned to the merchant.
          </Result>
        )}
        {elig.kind === "not-refundable" && (
          <Notice>
            {view.state === "DELIVERED"
              ? "Delivered and settled — there is nothing to refund."
              : "This shipment is not in a refundable state."}
          </Notice>
        )}

        <div className="space-y-2" style={{ borderTop: "1px solid var(--hairline)", paddingTop: 16 }}>
          <Field
            label="Report an issue"
            hint="sets a thin-dispute flag on ship:<id> — deep arbitration is a follow-on"
          >
            <TextInput
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. package never arrived"
            />
          </Field>
          <ActionButton
            variant="ghost"
            onClick={report}
            disabled={!reason.trim() || reported}
            loading={runningKey === "report"}
            loadingLabel="Filing report…"
          >
            {reported ? "Reported ✓" : "Report shipment"}
          </ActionButton>
          {reported && (
            <Result>
              ✓ Report filed against shipment #{shipmentId} — a reviewer can read the
              flag from the mailbox.
            </Result>
          )}
        </div>

        {error && <InlineError title={error.title} detail={error.detail} />}
      </div>
    );
  }

  ```

- [ ] **Step 10: Typecheck + lint.**
  ```
  cd dashboard && bunx tsc --noEmit && bun run lint
  ```
  Expected: `tsc` prints nothing (exit 0); lint prints `✔ No ESLint warnings or errors` (exit 0). If lint flags an apostrophe, it is in JSX text — use `&apos;` (already done for `registry&apos;s`).

- [ ] **Step 11: Build + runtime check the route.**
  ```
  cd dashboard && bun run build
  ```
  Expected: `Compiled successfully`, exit 0, and `/api/dispute/report` appears in the route manifest. Then start and hit the route (no `sleep`; `--retry-connrefused` waits for boot):
  ```
  cd dashboard && bun run start -- -p 3999 &
  curl -s --retry 30 --retry-delay 1 --retry-connrefused \
    -X POST http://localhost:3999/api/dispute/report \
    -H 'Content-Type: application/json' \
    -d '{"shipmentId":999999,"reason":"qa"}'
  echo
  pkill -f "next start"
  ```
  Expected (no shipment created → graceful envelope, never a crash):
  ```
  {"ok":false,"error":"no stored record for shipment 999999"}
  ```
  (With a real created shipment id the same call returns `{"ok":true,"data":{"reported":true,"at":<ms>}}`.)

- [ ] **Step 12: Scan for secrets and commit.**
  ```
  cd /Users/dadadave/Dev/Stellar/aegis-relay && \
  git add -A && \
  (git diff --cached | grep -nE 'S[A-Z2-7]{55}' && echo "SECRET FOUND — abort" || echo "no secrets") && \
  git commit -m "feat(disputes): thin refund + report flag in merchant panel

Surface a first-class Refund (deadline passed) action wrapping the existing
refund_expired two-step wallet flow, gated by refundEligibility (mirrors the
registry Open/InTransit + strict deadline gate), plus a lightweight report flag
stored on ship:<id> via reportShipFlow / POST /api/dispute/report."
  ```
  Expected: prints `no secrets`, then a commit summary listing the new/edited files.


### Task 11: Console wiring — merchant claim-link + market-first carrier flow

**Files:**
- `dashboard/lib/console/deep-link.ts` (new, pure) — `parseClaimedId`, `claimUrl`
- `dashboard/lib/console/deep-link.test.ts` (new, `bun:test`)
- `dashboard/components/Nav.tsx` (edit) — add `/market` link + claim-link affordance
- `dashboard/components/console/Console.tsx` (edit) — honor `/console?claimed=<id>`
- `dashboard/components/console/RolePanels.tsx` (edit) — Merchant claim-link/listing surface; Carrier "Claim from market"

**Interfaces:**
- **Consumes:**
  - Create-flow result carries the claim link — `useWalletFlows().create(params): Promise<ActionResult<SubmitTxRes>>` where Task 3 threads `BuildTxRes.claimLink` onto the create result as `claimLink?: string` (a `/claim/<id>#<seedHex>` path; the seed rides the fragment). Read defensively as `(res.data as { claimLink?: string }).claimLink` so this task compiles independently of Task 3's exact type edit.
  - `/market` route + page (Task 7) — deep-link target for the Carrier CTA and Nav.
  - Existing session API (unchanged): `setCurrentShipmentId(id)`, `setRole(r)`, `useWalletFlows().create`.
- **Produces:**
  - `parseClaimedId(search: string): number | null` — parse `?claimed=<id>` (leading `?` optional; non-negative safe integers only).
  - `claimUrl(origin: string, claimLink: string): string` — absolutize a `/claim/<id>#<seed>` path against an origin, preserving the seed fragment; pass absolute URLs through.

---

- [ ] **Step 1: Write the failing bun:test for the deep-link helpers (TDD).** Create `dashboard/lib/console/deep-link.test.ts`:
  ```ts
  import { test, expect } from "bun:test";
  import { parseClaimedId, claimUrl } from "./deep-link";

  test("parseClaimedId reads a numeric ?claimed", () => {
    expect(parseClaimedId("?claimed=42")).toBe(42);
    expect(parseClaimedId("claimed=42")).toBe(42);
    expect(parseClaimedId("?foo=1&claimed=7&bar=2")).toBe(7);
  });

  test("parseClaimedId rejects missing / non-numeric", () => {
    expect(parseClaimedId("")).toBe(null);
    expect(parseClaimedId("?other=1")).toBe(null);
    expect(parseClaimedId("?claimed=abc")).toBe(null);
    expect(parseClaimedId("?claimed=")).toBe(null);
    expect(parseClaimedId("?claimed=-3")).toBe(null);
  });

  test("claimUrl absolutizes a claim path, preserving the seed fragment", () => {
    expect(claimUrl("https://app.example.com", "/claim/7#deadbeef")).toBe(
      "https://app.example.com/claim/7#deadbeef",
    );
    expect(claimUrl("https://app.example.com/", "/claim/7#seed")).toBe(
      "https://app.example.com/claim/7#seed",
    );
    expect(claimUrl("https://app.example.com", "claim/7#seed")).toBe(
      "https://app.example.com/claim/7#seed",
    );
  });

  test("claimUrl passes an already-absolute link through unchanged", () => {
    expect(claimUrl("https://app.example.com", "https://other.host/claim/7#seed")).toBe(
      "https://other.host/claim/7#seed",
    );
  });
  ```
  Run and confirm it FAILS (module missing):
  ```
  cd dashboard && bun test lib/console/deep-link.test.ts
  ```
  Expected: an error like `error: Cannot find module './deep-link'` (0 pass).

- [ ] **Step 2: Implement the pure helpers so the test passes.** Create `dashboard/lib/console/deep-link.ts`:
  ```ts
  /**
   * Pure helpers for the console's marketplace deep-links (Task 11). No DOM/React
   * imports so they unit-test under bun:test. Used by Console.tsx (honor
   * `?claimed=<id>`) and the Merchant panel (absolutize the recipient claim link).
   */

  /** Parse `?claimed=<id>` into a shipment id, or null. Search string may include
   *  a leading "?". Only non-negative safe integers are accepted. */
  export function parseClaimedId(search: string): number | null {
    const q = search.startsWith("?") ? search.slice(1) : search;
    const raw = new URLSearchParams(q).get("claimed");
    if (raw === null || !/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
  }

  /** Turn a server-returned claim link (a `/claim/<id>#<seedHex>` PATH, or an
   *  already-absolute URL) into an absolute, shareable URL against `origin`. The
   *  seed fragment is preserved verbatim — it never leaves the browser. */
  export function claimUrl(origin: string, claimLink: string): string {
    if (/^https?:\/\//i.test(claimLink)) return claimLink;
    const base = origin.replace(/\/+$/, "");
    const path = claimLink.startsWith("/") ? claimLink : `/${claimLink}`;
    return `${base}${path}`;
  }
  ```
  Re-run:
  ```
  cd dashboard && bun test lib/console/deep-link.test.ts
  ```
  Expected: `4 pass, 0 fail`.

- [ ] **Step 3: Rewrite `Nav.tsx` — add the Market link + a claim-link affordance.** Replace the entire contents of `dashboard/components/Nav.tsx` with:
  ```tsx
  import Link from "next/link";

  const links = [
    { href: "/", label: "Overview" },
    { href: "/map", label: "Corridor" },
    { href: "/market", label: "Market" },
    { href: "/verify", label: "Verify" },
  ];

  const cta = { href: "/console", label: "Open the app" };

  export default function Nav() {
    return (
      <header className="border-b hairline">
        <nav className="max-w-6xl mx-auto flex items-center gap-6 px-6 h-14">
          <Link href="/" className="display flex items-center" style={{ fontSize: "var(--text-md)", fontWeight: 700 }}>
            AEGIS<span style={{ color: "var(--seal)" }}>&nbsp;RELAY</span>
          </Link>
          <div className="flex gap-5" style={{ fontSize: "var(--text-sm)", color: "var(--ink-dim)" }}>
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="transition-colors hover:[color:var(--ink)]"
              >
                {l.label}
              </Link>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-4">
            <span
              className="hidden sm:inline"
              title="Recipients: the merchant sends you a claim link (/claim/<id>#seed). Open it directly to sign for delivery — the signing seed stays in your browser and never reaches the server."
              style={{ fontSize: "var(--text-xs)", color: "var(--ink-dim)", cursor: "help", borderBottom: "1px dotted var(--hairline)" }}
            >
              Have a claim link?
            </span>
            <Link
              href={cta.href}
              className="transition-transform active:scale-[.98]"
              style={{ background: "var(--seal)", color: "var(--on-mint)", fontWeight: 600, fontSize: "var(--text-sm)", borderRadius: "var(--r-control)", padding: "6px 14px" }}
            >
              {cta.label}
            </Link>
          </div>
        </nav>
      </header>
    );
  }
  ```

- [ ] **Step 4: `Console.tsx` — honor the `?claimed=<id>` deep-link.** In `dashboard/components/console/Console.tsx`, add the import (after the existing `useSession` import line):
  ```tsx
  import { parseClaimedId } from "@/lib/console/deep-link";
  ```
  Widen the `useSession()` destructure — replace:
  ```tsx
    const { role, hasChosenRole, chooseRole, syncChosen, setActiveCount, shipment, toggleLens } =
      useSession();
  ```
  with:
  ```tsx
    const {
      role, hasChosenRole, chooseRole, syncChosen, setActiveCount, shipment,
      toggleLens, setCurrentShipmentId, setRole,
    } = useSession();
  ```
  Then add this effect immediately after the Ledger-Lens `useEffect(...)` block (the one that ends with `}, [toggleLens]);`):
  ```tsx
    // Deep-link back from the market: `/console?claimed=<id>` (Task 11) focuses the
    // just-claimed shipment and switches to the Carrier station so Accept is
    // unlocked. One-shot on mount; the param is stripped so a refresh won't re-fire.
    // Both this write and SessionProvider's localStorage-restore write SHIPMENT_KEY,
    // so the focused id converges to <id> regardless of effect order.
    useEffect(() => {
      const id = parseClaimedId(window.location.search);
      if (id === null) return;
      setRole("carrier");
      setCurrentShipmentId(id);
      const url = new URL(window.location.href);
      url.searchParams.delete("claimed");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }, [setRole, setCurrentShipmentId]);
  ```

- [ ] **Step 5: `RolePanels.tsx` — imports + `ClaimLinkCard` + Merchant wiring.** In `dashboard/components/console/RolePanels.tsx`, add two imports at the top of the import block (right after `import { useState, type ReactNode } from "react";`):
  ```tsx
  import Link from "next/link";
  import { claimUrl } from "@/lib/console/deep-link";
  ```
  Add the `ClaimLinkCard` component directly after the existing `Result` function (before the `// ── Merchant ──` divider):
  ```tsx
  /** Post-create Merchant surface: listing status + the copyable recipient claim
   *  link. The seed lives only in the URL fragment (`#…`) — never on the server. */
  function ClaimLinkCard({ shipmentId, claimLink }: { shipmentId: number; claimLink: string | null }) {
    const [copied, setCopied] = useState(false);
    const url =
      claimLink !== null && typeof window !== "undefined"
        ? claimUrl(window.location.origin, claimLink)
        : claimLink;
    const copy = () => {
      if (url && typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }
    };
    return (
      <Result>
        <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 10 }}>
          <span className="stamp" style={{ color: "var(--verified)" }}>Listed · OPEN</span>
          <span className="text-xs" style={{ color: "var(--ink-dim)" }}>
            Shipment <span className="mono">#{shipmentId}</span> is live on the{" "}
            <Link href="/market" className="hover:underline" style={{ color: "var(--seal)" }}>carrier market</Link>{" "}
            — a credentialed carrier can claim it now.
          </span>
        </div>

        {url ? (
          <>
            <div className="stamp" style={{ color: "var(--chain-dim)" }}>Recipient claim link</div>
            <p className="text-xs" style={{ margin: "4px 0 10px", color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
              Send this to the recipient. The signing seed rides in the URL fragment (after the{" "}
              <span className="mono">#</span>) and never reaches the server.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Recipient claim link"
                className="mono w-full min-w-0 rounded-[var(--r-control)] px-3 py-2.5 text-xs outline-none border hairline"
                style={{ background: "var(--void-0)", color: "var(--ink)" }}
              />
              <button
                onClick={copy}
                style={{ minHeight: 40, padding: "0 14px", borderRadius: "var(--r-control)", border: "1px solid var(--hairline)", background: "var(--void-1)", color: copied ? "var(--verified)" : "var(--ink-dim)", fontSize: "var(--text-sm)", cursor: "pointer", whiteSpace: "nowrap" }}
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </>
        ) : (
          <p className="text-xs" style={{ margin: 0, color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}>
            Recipient claim link unavailable for this shipment.
          </p>
        )}
      </Result>
    );
  }
  ```
  In `MerchantPanel`, add the created-state var — replace:
  ```tsx
    const [deadline, setDeadline] = useState("24");

    const walletReady = !!stellarAddress;
  ```
  with:
  ```tsx
    const [deadline, setDeadline] = useState("24");
    const [created, setCreated] = useState<{ shipmentId: number; claimLink: string | null } | null>(null);

    const walletReady = !!stellarAddress;
  ```
  Reset it at the start of the create run — replace:
  ```tsx
      run("create", async () => {
        const amt = Number(amount);
  ```
  with:
  ```tsx
      run("create", async () => {
        setCreated(null);
        const amt = Number(amount);
  ```
  Capture the claim link on success — replace:
  ```tsx
          setCurrentShipmentId(shipmentId);
          setCreatedDest(shipmentId, { lat: Number(toLat), lon: Number(toLon) });
          if (view) applyView(view);
  ```
  with:
  ```tsx
          setCurrentShipmentId(shipmentId);
          setCreatedDest(shipmentId, { lat: Number(toLat), lon: Number(toLon) });
          setCreated({
            shipmentId,
            claimLink: (res.data as { claimLink?: string }).claimLink ?? null,
          });
          if (view) applyView(view);
  ```
  Render the card after the create button — replace:
  ```tsx
        >
          Create shipment
        </ActionButton>

        {method === "drone" && (
          <Honesty>
  ```
  with:
  ```tsx
        >
          Create shipment
        </ActionButton>

        {created && <ClaimLinkCard shipmentId={created.shipmentId} claimLink={created.claimLink} />}

        {method === "drone" && (
          <Honesty>
  ```

- [ ] **Step 6: `RolePanels.tsx` — Carrier "Claim from market" (replace focus-an-id).** Add the `ClaimFromMarket` component directly before the `// ── Carrier ──` divider (after `ClaimLinkCard`):
  ```tsx
  /** Carrier no-shipment state: carriers discover jobs on the market, not via a
   *  raw id box. Deep-links to /market; a claim there returns with ?claimed=<id>. */
  function ClaimFromMarket() {
    return (
      <div
        className="text-sm space-y-4"
        style={{ background: "var(--void-0)", border: "1px solid var(--hairline)", borderRadius: "var(--r-control)", padding: 16, color: "var(--ink-dim)", lineHeight: "var(--lh-body)" }}
      >
        <p style={{ margin: 0 }}>
          Carriers don&apos;t get handed a shipment id — you{" "}
          <span style={{ color: "var(--ink)" }}>discover</span> open jobs on the market and
          claim one. Claiming focuses it here with <span className="mono">Accept</span> unlocked
          (first valid accept wins on-chain).
        </p>
        <Link
          href="/market"
          className="inline-flex items-center justify-center gap-2 rounded-[var(--r-control)] px-[18px] py-2.5 text-sm font-semibold min-h-[44px] transition-transform active:scale-[0.98]"
          style={{ background: "var(--seal)", color: "#0B0716" }}
        >
          Claim from market →
        </Link>
      </div>
    );
  }
  ```
  In `CarrierPanel`'s no-shipment branch, swap the body — replace:
  ```tsx
        subtitle="Verify the sealed packet against the on-chain commitment, accept custody, prove the flight, then prove delivery."
        >
          <NeedShipment />
        </Panel>
  ```
  with:
  ```tsx
        subtitle="Discover an open shipment on the market and claim it — then verify the sealed packet, accept custody, prove the flight, and prove delivery."
        >
          <ClaimFromMarket />
        </Panel>
  ```
  (`NeedShipment` stays — Recipient/Auditor panels still use it, so no unused-symbol lint.)

- [ ] **Step 7: Typecheck.** Run:
  ```
  cd dashboard && bunx tsc --noEmit
  ```
  Expected: exit 0, no output. (If it reports `claimLink` unrelated errors, confirm Task 3 landed first — the defensive `as { claimLink?: string }` read here is Task-3-independent.)

- [ ] **Step 8: Lint.** Run:
  ```
  cd dashboard && bun run lint
  ```
  Expected: exit 0 (no errors/warnings for the touched files).

- [ ] **Step 9: Production build.** Run:
  ```
  cd dashboard && bun run build
  ```
  Expected: `✓ Compiled successfully`, exit 0, `/console` and `/` listed in the route table.

- [ ] **Step 10: Runtime render check.** Serve the build and confirm the console + Nav render:
  ```
  cd dashboard && bun run start -- -p 3111 &
  SERVER=$!
  until curl -sf -o /dev/null http://localhost:3111/; do sleep 1; done
  curl -s -o /dev/null -w "console: %{http_code}\n" http://localhost:3111/console
  curl -s http://localhost:3111/ | grep -c "Market"
  curl -s http://localhost:3111/ | grep -c "Have a claim link"
  curl -s http://localhost:3111/console | grep -c "demoFadeUp"
  kill $SERVER
  ```
  Expected:
  ```
  console: 200
  1
  1
  1
  ```
  (`console: 200` = the console page serves; the two `/` matches confirm the Nav Market link + claim-link affordance are server-rendered; `demoFadeUp` confirms the console shell — which gates into `LoginScreen` client-side — rendered. Optionally open `http://localhost:3111/console` in a browser to see the login screen, then `http://localhost:3111/console?claimed=5` to confirm it focuses shipment #5 on the Carrier station.)

- [ ] **Step 11: Commit.** Run:
  ```
  cd dashboard && git add lib/console/deep-link.ts lib/console/deep-link.test.ts components/Nav.tsx components/console/Console.tsx components/console/RolePanels.tsx && git commit -m "feat(console): recipient claim-link surface + market-first carrier flow (Task 11)"
  ```
  Expected: one commit created with the five files staged.

