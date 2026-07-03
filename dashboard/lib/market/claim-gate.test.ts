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
