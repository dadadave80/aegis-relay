/**
 * Adapts the connected Stellar Wallets Kit wallet to the @ctd/sdk {@link Signer}
 * interface (replaces the demo's lib/freighter.ts, which was Freighter-only).
 *
 * GATE: the confidential rail requires **Freighter**. Key derivation
 * (derive-key.ts) needs a DETERMINISTIC ed25519 `signMessage`; Freighter
 * guarantees it, other kit wallets (Albedo/xBull/Lobstr/Hana/Rabet) may sign
 * non-deterministically or lack `signMessage`, which would orphan the hidden
 * balance. The console disables the confidential rail unless Freighter is the
 * active wallet; the transparent + drone rails work with any wallet.
 */
import type { Signer } from "@ctd/sdk";

/** The kit's product id for Freighter (@creit.tech/.../modules/freighter). */
export const FREIGHTER_ID = "freighter";

/** Minimal structural view of the kit statics we use (the context holds `any`). */
export interface KitLike {
  selectedModule?: { productId?: string };
  signTransaction(
    xdr: string,
    opts: { address: string; networkPassphrase: string },
  ): Promise<{ signedTxXdr: string }>;
  signMessage(
    message: string,
    opts: { address: string; networkPassphrase: string },
  ): Promise<{ signedMessage: unknown; signerAddress?: string }>;
}

/** True iff the active kit wallet is Freighter (safe to derive a stable key). */
export function isFreighterActive(kit: KitLike): boolean {
  try {
    return kit.selectedModule?.productId === FREIGHTER_ID;
  } catch {
    return false;
  }
}

/** A {@link Signer} that can also sign arbitrary UTF-8 messages (SEP-53). */
export interface MessageSigner extends Signer {
  /** Sign a message and return the raw ed25519 signature bytes. */
  signMessage(message: string): Promise<Uint8Array>;
}

/**
 * Build a message-capable Signer from the connected kit wallet. Throws if the
 * active wallet isn't Freighter (the caller should have gated the rail already;
 * this is the backstop).
 */
export function kitMessageSigner(
  kit: KitLike,
  address: string,
  networkPassphrase: string,
): MessageSigner {
  if (!isFreighterActive(kit)) {
    throw new Error(
      "The confidential rail requires Freighter (deterministic message signing). " +
        "Connect Freighter, or use the transparent rail.",
    );
  }
  return {
    publicKey: address,
    async sign(txXdrBase64: string): Promise<string> {
      const { signedTxXdr } = await kit.signTransaction(txXdrBase64, {
        address,
        networkPassphrase,
      });
      return signedTxXdr;
    },
    async signMessage(message: string): Promise<Uint8Array> {
      const res = await kit.signMessage(message, { address, networkPassphrase });
      if (res.signerAddress && res.signerAddress !== address) {
        throw new Error(`wallet signed with ${res.signerAddress}, expected ${address}`);
      }
      return normalizeSignature(res.signedMessage);
    },
  };
}

/** Kit/Freighter v4 returns a base64 string; older paths a Buffer/byte array. */
function normalizeSignature(signed: unknown): Uint8Array {
  if (typeof signed === "string") {
    return Uint8Array.from(atob(signed), (c) => c.charCodeAt(0));
  }
  if (signed instanceof Uint8Array) return new Uint8Array(signed);
  if (signed && typeof signed === "object" && Array.isArray((signed as { data?: unknown }).data)) {
    return Uint8Array.from((signed as { data: number[] }).data);
  }
  throw new Error("wallet returned no usable message signature");
}
