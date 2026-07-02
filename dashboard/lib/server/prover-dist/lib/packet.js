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
import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
/** prover/ package root (lib → src → prover). `out/` is runtime scratch. */
export const PROVER_ROOT = resolve(__dirname, '../..');
export const OUT_ROOT = join(PROVER_ROOT, 'out');
export const PACKET_VERSION = 1;
const SEAL_ALG = 'x25519-chacha20poly1305';
const HKDF_INFO = Buffer.from('aegis-relay/packet/x25519-chacha20poly1305/v1');
// ── X25519 sealed box ───────────────────────────────────────────────────────
/** Generate an X25519 keypair as SPKI/PKCS8 PEM strings. */
export function generatePacketKeypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}
const spkiDer = (key) => key.export({ type: 'spki', format: 'der' });
function deriveKeyNonce(shared, salt) {
    const okm = Buffer.from(crypto.hkdfSync('sha256', shared, salt, HKDF_INFO, 44));
    return { key: okm.subarray(0, 32), nonce: okm.subarray(32, 44) };
}
/** Seal an arbitrary JSON-serializable object to a recipient's X25519 pub PEM. */
export function sealX25519(recipientPubPem, obj) {
    const recipientPub = crypto.createPublicKey({ key: recipientPubPem, format: 'pem' });
    const eph = crypto.generateKeyPairSync('x25519');
    const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: recipientPub });
    const epkDer = spkiDer(eph.publicKey);
    const recipDer = spkiDer(recipientPub);
    const salt = Buffer.concat([epkDer, recipDer]);
    const { key, nonce } = deriveKeyNonce(shared, salt);
    const cipher = crypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
    cipher.setAAD(salt);
    const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        v: PACKET_VERSION,
        alg: SEAL_ALG,
        epk: eph.publicKey.export({ type: 'spki', format: 'pem' }),
        ct: ct.toString('hex'),
        tag: tag.toString('hex'),
    };
}
/** Open a sealed box with the recipient's X25519 private PEM. Throws on tamper. */
export function openX25519(privPem, sealed) {
    if (sealed.alg !== SEAL_ALG)
        throw new Error(`unsupported seal alg: ${sealed.alg}`);
    const recipientPriv = crypto.createPrivateKey({ key: privPem, format: 'pem' });
    const recipientPub = crypto.createPublicKey(recipientPriv);
    const epk = crypto.createPublicKey({ key: sealed.epk, format: 'pem' });
    const shared = crypto.diffieHellman({ privateKey: recipientPriv, publicKey: epk });
    const salt = Buffer.concat([spkiDer(epk), spkiDer(recipientPub)]);
    const { key, nonce } = deriveKeyNonce(shared, salt);
    const decipher = crypto.createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
    decipher.setAAD(salt);
    decipher.setAuthTag(Buffer.from(sealed.tag, 'hex'));
    const pt = Buffer.concat([decipher.update(Buffer.from(sealed.ct, 'hex')), decipher.final()]);
    return JSON.parse(pt.toString('utf8'));
}
// ── Packet I/O (out/ships/<id>/) ────────────────────────────────────────────
/** out/ships/<id>/ — created on demand. `id` may be a number or decimal string. */
export function shipDir(id) {
    const dir = join(OUT_ROOT, 'ships', String(id));
    mkdirSync(dir, { recursive: true });
    return dir;
}
/** Write the plaintext packet.json (the demo artifact). Returns its path. */
export function writePacket(id, packet) {
    const path = join(shipDir(id), 'packet.json');
    writeFileSync(path, JSON.stringify(packet, null, 2) + '\n');
    return path;
}
/** Read a packet.json (or any packet JSON) from `path`. */
export function readPacket(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}
/** Seal the packet to `recipientPubPem` and write packet.sealed. Returns path. */
export function writeSealedPacket(id, recipientPubPem, packet) {
    const path = join(shipDir(id), 'packet.sealed');
    writeFileSync(path, JSON.stringify(sealX25519(recipientPubPem, packet), null, 2) + '\n');
    return path;
}
/** True if `path` exists (small helper for CLIs). */
export function fileExists(path) {
    return existsSync(path);
}
