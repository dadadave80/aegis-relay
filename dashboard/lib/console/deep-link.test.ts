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
