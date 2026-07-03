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
