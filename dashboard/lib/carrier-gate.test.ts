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
