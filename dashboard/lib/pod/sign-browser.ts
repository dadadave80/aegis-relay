"use client";

/**
 * sign-browser.ts — in-browser EdDSA-Poseidon proof-of-delivery signing.
 *
 * The recipient's Baby Jubjub claim seed arrives ONLY in the /claim link URL
 * fragment (#<seedHex>) and never leaves the browser. This module derives the
 * key, signs
 *   m = Poseidon(DOM_PODMSG, shipment_id, carrier_pk_commit, cell_rd, ts)
 * and returns the signature so the /claim page (Task 6) POSTs only {R8, S}.
 *
 * Faithful mirror of prover-dist/recipient.ts `signPod` (the server reference):
 * identical DOM_PODMSG=5 tag, the buildPoseidon → decimal → `bjF.e(BigInt(...))`
 * field re-encoding of prover-dist/lib/poseidon.ts, and the buildEddsa signer.
 * Parity is proven by sign-browser.test.ts (pinned golden vector + verifyPoseidon).
 *
 * circomlibjs is already a dashboard dep and runs isomorphically. NOTE: its
 * eddsa internals call the global `Buffer`, absent in the browser — the /claim
 * page (Task 6) adds a webpack Buffer ProvidePlugin. Signing needs no randomness.
 */
import { buildEddsa, buildPoseidon } from "circomlibjs";

// DOM_PODMSG (DESIGN §5.2): proof-of-delivery message tag. Mirrors
// prover-dist/lib/constants.ts; a bare Poseidon call is a spec violation.
const DOM_PODMSG = 5n;

// circomlibjs instances are async + heavy; build once per page session.
let eddsaInstance: Awaited<ReturnType<typeof buildEddsa>> | null = null;
let poseidonInstance: Awaited<ReturnType<typeof buildPoseidon>> | null = null;

async function getEddsa() {
  if (eddsaInstance === null) eddsaInstance = await buildEddsa();
  return eddsaInstance;
}
async function getPoseidon() {
  if (poseidonInstance === null) poseidonInstance = await buildPoseidon();
  return poseidonInstance;
}

/** hex string → Uint8Array. Browser-safe: does not depend on a global Buffer. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("seedHex must have an even length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error("seedHex is not valid hex");
    out[i] = byte;
  }
  return out;
}

export interface SignPodBrowserArgs {
  seedHex: string;
  shipmentId: number;
  carrierPkCommit: string;
  cellRd: string;
  ts: number;
}

/**
 * Sign the PoD message in the browser with the recipient's claim key.
 * Returns the EdDSA-Poseidon signature as decimal strings: R8 = [R8x, R8y], S.
 */
export async function signPodBrowser(
  args: SignPodBrowserArgs,
): Promise<{ R8: [string, string]; S: string }> {
  const [eddsa, poseidon] = await Promise.all([getEddsa(), getPoseidon()]);
  const bjF = eddsa.babyJub.F;
  const seed = hexToBytes(args.seedHex);

  // m = Poseidon(DOM_PODMSG, shipment_id, carrier_pk_commit, cell_rd, ts).
  // Decimal string, then re-encode into the signing field via bjF.e(...) —
  // identical to prover-dist/recipient.ts signPod.
  const msgDec = poseidon.F.toString(
    poseidon([
      DOM_PODMSG,
      BigInt(args.shipmentId),
      BigInt(args.carrierPkCommit),
      BigInt(args.cellRd),
      BigInt(args.ts),
    ]),
  );
  const sig = eddsa.signPoseidon(seed, bjF.e(BigInt(msgDec)));

  return {
    R8: [bjF.toObject(sig.R8[0]).toString(), bjF.toObject(sig.R8[1]).toString()],
    S: sig.S.toString(),
  };
}
