/**
 * packet.ts — the off-chain shipment packet (DESIGN.md §6.5) and its
 * authenticated encryption, built entirely on node's BUILT-IN crypto (no npm
 * deps).
 *
 * The packet carries everything the counterparties need and the chain never
 * sees: the full C_S opening, the destination-region tree (cells + root +
 * per-cell inclusion paths), the recipient's EdDSA claim seed, and lane/corridor
 * references. The carrier verifies the C_S opening against the on-chain
 * commitment before accepting — packet-verify is the carrier's protection
 * against a garbage-commitment merchant (DESIGN.md §12 row T12), on by default.
 *
 * ── Sealed-box construction (libsodium crypto_box_seal equivalent) ──────────
 * A one-shot anonymous sealed box for `merchant → {carrier, recipient}`:
 *
 *   1. Sender generates an EPHEMERAL X25519 keypair (epk, esk) per message.
 *   2. shared = X25519(esk, recipient_pub)                      (ECDH)
 *   3. okm    = HKDF-SHA256(ikm = shared,
 *                           salt = epk_spki_der || recipient_spki_der,
 *                           info = "aegis-relay/packet/x25519-chacha20poly1305/v1",
 *                           len  = 44)
 *      key = okm[0..32], nonce = okm[32..44]     (12-byte ChaCha20-Poly1305 nonce)
 *   4. (ct, tag) = ChaCha20-Poly1305(key, nonce,
 *                    aad = epk_spki_der || recipient_spki_der, plaintext)
 *   5. sealed = { v, alg, epk (spki PEM), ct (hex), tag (hex) }
 *
 * The nonce is HKDF-derived (not stored) — safe because the key is unique per
 * message (fresh ephemeral). Binding both public keys into the salt+AAD gives
 * key-compromise-impersonation resistance and makes any epk/recipient swap a
 * decrypt failure. The recipient recomputes shared = X25519(recipient_priv, epk)
 * and its own spki DER from the private key, so no extra material travels.
 * Tampering with ct/tag/epk fails the Poly1305 tag → `openX25519` throws.
 */
/** prover/ package root (lib → src → prover). `out/` is runtime scratch. */
export declare const PROVER_ROOT: string;
export declare const OUT_ROOT: string;
export declare const PACKET_VERSION = 1;
/** The 11 C_S opening fields (DESIGN.md §6.1), all decimal strings. */
export interface CsOpening {
    sku_hash: string;
    qty: string;
    weight_g: string;
    value_units: string;
    origin_cell: string;
    dest_region_root: string;
    recipient_pk_x: string;
    recipient_pk_y: string;
    method: string;
    deadline_ts: string;
    shipment_secret: string;
}
export interface DestCellPath {
    pathElements: string[];
    pathIndices: number[];
}
/** Depth-6 destination region: the RD cells, their root, per-cell paths. */
export interface DestRegion {
    cells: string[];
    root: string;
    paths: DestCellPath[];
}
export interface Packet {
    version: number;
    /** Set once the shipment is created on-chain (sequential u64, decimal). */
    shipment_id?: string;
    /** The commitment itself (recomputable from `cs_opening`). */
    c_s: string;
    cs_opening: CsOpening;
    dest_region: DestRegion;
    /**
     * carrier_pk_commit opening reference. The merchant cannot know the carrier's
     * key at pack time; the carrier fills this in at `accept` (persisted from
     * out/carrier-key.json) so a later `prove-delivery` can open it in-circuit.
     */
    carrier_pk_commit?: string;
    recipient_claim: {
        eddsa_seed_hex: string;
    };
    lane_id?: number;
    corridor_ref?: string;
}
export interface Sealed {
    v: number;
    alg: string;
    /** Ephemeral X25519 public key, SPKI PEM. */
    epk: string;
    /** Ciphertext, hex. */
    ct: string;
    /** Poly1305 tag, hex. */
    tag: string;
}
/** Generate an X25519 keypair as SPKI/PKCS8 PEM strings. */
export declare function generatePacketKeypair(): {
    publicKeyPem: string;
    privateKeyPem: string;
};
/** Seal an arbitrary JSON-serializable object to a recipient's X25519 pub PEM. */
export declare function sealX25519(recipientPubPem: string, obj: unknown): Sealed;
/** Open a sealed box with the recipient's X25519 private PEM. Throws on tamper. */
export declare function openX25519(privPem: string, sealed: Sealed): unknown;
/** out/ships/<id>/ — created on demand. `id` may be a number or decimal string. */
export declare function shipDir(id: string | number): string;
/** Write the plaintext packet.json (the demo artifact). Returns its path. */
export declare function writePacket(id: string | number, packet: Packet): string;
/** Read a packet.json (or any packet JSON) from `path`. */
export declare function readPacket(path: string): Packet;
/** Seal the packet to `recipientPubPem` and write packet.sealed. Returns path. */
export declare function writeSealedPacket(id: string | number, recipientPubPem: string, packet: Packet): string;
/** True if `path` exists (small helper for CLIs). */
export declare function fileExists(path: string): boolean;
