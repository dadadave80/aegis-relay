import { test, expect } from "bun:test";
import { isValidStellarAddress } from "./carrier-gate";

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
