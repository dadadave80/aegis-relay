/**
 * Deterministic confidential-key derivation from a wallet signature.
 * (Ported verbatim from ct-demo/packages/app/lib/derive-key.ts.)
 *
 * Ed25519 signatures are deterministic (RFC 8032): signing the same message
 * with the same account always yields the same bytes, so `sk = SHA-512(signature)
 * mod r` is stable across devices and browsers and survives localStorage loss.
 * The message folds in the network passphrase and token contract id, so a
 * signature obtained for one deployment cannot derive keys for another.
 *
 * The determinism guarantee is why the confidential rail requires Freighter —
 * see wallet-signer.ts. A wallet that signs messages non-deterministically would
 * derive a DIFFERENT key each session, orphaning the confidential balance.
 */

import { frMod, fromBytesBE } from "@ctd/sdk";

export function keyDerivationMessage(networkPassphrase: string, tokenContract: string): string {
  return [
    "Aegis Relay — confidential key derivation v1",
    "",
    "Signing this message derives your confidential spending key.",
    "Only sign it on the official Aegis Relay console.",
    "",
    `Network: ${networkPassphrase}`,
    `Token contract: ${tokenContract}`,
  ].join("\n");
}

/** Hash a message signature into a nonzero F_r scalar. */
export async function skFromSignature(signature: Uint8Array): Promise<bigint> {
  const digest = await crypto.subtle.digest("SHA-512", signature as BufferSource);
  const sk = frMod(fromBytesBE(new Uint8Array(digest)));
  if (sk === 0n) throw new Error("degenerate key derivation (zero scalar)");
  return sk;
}
