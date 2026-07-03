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

// Named to avoid the `use*` prefix: eslint's react-hooks plugin treats any
// top-level `use*` function as a React Hook and flags this call site.
function shouldUseVercelKv(): boolean {
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

// Vercel's Upstash / Marketplace Redis integration sometimes injects the store
// credentials under UPSTASH_REDIS_REST_* names instead of the @vercel/kv
// KV_REST_API_* names this module (and @vercel/kv) read. Bridge them so a store
// connected under either naming convention is picked up.
if (
  !process.env.KV_REST_API_URL &&
  process.env.UPSTASH_REDIS_REST_URL &&
  process.env.UPSTASH_REDIS_REST_TOKEN
) {
  process.env.KV_REST_API_URL = process.env.UPSTASH_REDIS_REST_URL;
  process.env.KV_REST_API_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
}

export const kv: Kv = shouldUseVercelKv() ? makeVercelKv() : makeMemoryKv();
