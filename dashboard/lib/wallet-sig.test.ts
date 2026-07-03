import { test, expect } from "bun:test";
import { Keypair } from "@stellar/stellar-sdk";
import { buildClaimChallenge, verifyWalletSignature } from "./wallet-sig";

const MESSAGE = buildClaimChallenge(42, "abc123deadbeef");

test("verifyWalletSignature passes for a signature over the exact challenge", () => {
  const kp = Keypair.random();
  const sigB64 = kp.sign(Buffer.from(MESSAGE, "utf8")).toString("base64");
  expect(verifyWalletSignature(kp.publicKey(), MESSAGE, sigB64)).toBe(true);
});

test("verifyWalletSignature fails when the signed message is tampered", () => {
  const kp = Keypair.random();
  const sigB64 = kp.sign(Buffer.from(MESSAGE, "utf8")).toString("base64");
  expect(verifyWalletSignature(kp.publicKey(), MESSAGE + "!", sigB64)).toBe(false);
});

test("verifyWalletSignature fails against a different address than the signer", () => {
  const signer = Keypair.random();
  const impostor = Keypair.random();
  const sigB64 = signer.sign(Buffer.from(MESSAGE, "utf8")).toString("base64");
  expect(verifyWalletSignature(impostor.publicKey(), MESSAGE, sigB64)).toBe(false);
});

test("verifyWalletSignature fails gracefully on garbage input (never throws)", () => {
  const kp = Keypair.random();
  expect(verifyWalletSignature(kp.publicKey(), MESSAGE, "not-valid-base64-sig")).toBe(false);
  expect(verifyWalletSignature("not-an-address", MESSAGE, "AAAA")).toBe(false);
  expect(verifyWalletSignature("", "", "")).toBe(false);
});

test("buildClaimChallenge is deterministic given the same shipmentId + nonce", () => {
  expect(buildClaimChallenge(7, "txhash1")).toBe(buildClaimChallenge(7, "txhash1"));
  expect(buildClaimChallenge(7, "txhash1")).not.toBe(buildClaimChallenge(7, "txhash2"));
  expect(buildClaimChallenge(7, "txhash1")).not.toBe(buildClaimChallenge(8, "txhash1"));
});
