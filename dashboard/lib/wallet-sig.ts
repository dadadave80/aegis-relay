/**
 * dashboard/lib/wallet-sig.ts — Stellar wallet-ownership verification for the
 * recipient claim flow. Pure, no server deps and no `"server-only"` (mirrors
 * carrier-gate.ts), so it is unit-testable in isolation (wallet-sig.test.ts).
 *
 * The recipient proves control of the merchant-designated Stellar address by
 * signing a deterministic per-shipment challenge with their connected wallet
 * (Stellar Wallets Kit `signMessage`). The kit's module implementations (e.g.
 * node_modules/@creit.tech/stellar-wallets-kit/esm/sdk/modules/freighter.module.js)
 * return `{ signedMessage, signerAddress }` where `signedMessage` is the RAW
 * ed25519 signature bytes, base64-encoded (`encodeBase64(new Uint8Array(sig))`)
 * — so verification here decodes base64 → Buffer and checks it directly
 * against the challenge's UTF-8 bytes via `Keypair.verify`.
 */
import { Keypair } from "@stellar/stellar-sdk";

/**
 * Deterministic per-shipment challenge string, derived from stored fields
 * (the shipment id + a per-shipment nonce, e.g. its create tx hash) so the
 * POST handler can re-derive and compare without storing anything extra.
 */
export function buildClaimChallenge(shipmentId: number | string, nonce: string): string {
  return `Aegis Relay — confirm delivery of shipment ${shipmentId} — ${nonce}`;
}

/**
 * Verify a wallet's Ed25519 signature (as returned by the Stellar Wallets
 * Kit's `signMessage`, base64) over `message`, against the claimed `address`
 * (G...). Never throws — any malformed input (bad address, bad base64, wrong
 * signer) is simply `false`.
 */
export function verifyWalletSignature(
  address: string,
  message: string,
  signatureB64: string,
): boolean {
  try {
    if (!address || !message || !signatureB64) return false;
    const kp = Keypair.fromPublicKey(address);
    const sig = Buffer.from(signatureB64, "base64");
    if (sig.length === 0) return false;
    return kp.verify(Buffer.from(message, "utf8"), sig);
  } catch {
    return false;
  }
}
