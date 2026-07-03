/**
 * dashboard/lib/carrier-gate.ts — pure carrier address-shape validation.
 *
 * No server deps and no `"server-only"`: this holds only address-shape
 * validation, so it is unit-testable in isolation (carrier-gate.test.ts). The
 * store-backed, async onboarding/status/credential-gate flows (including the
 * live claim-path gate) live in lib/server/flows.ts.
 */

/** Stellar ed25519 public key: literal 'G' + 55 base32 chars (RFC 4648 alphabet). */
export function isValidStellarAddress(addr: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(addr);
}
