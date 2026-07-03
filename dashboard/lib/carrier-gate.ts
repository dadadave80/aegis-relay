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
