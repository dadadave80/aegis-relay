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
