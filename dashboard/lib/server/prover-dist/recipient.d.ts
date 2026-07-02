/**
 * recipient.ts — recipient operator CLI (DESIGN.md §8.4, actor "Recipient").
 *
 * The recipient never transacts on-chain. Holding the Baby Jubjub key from the
 * shipment packet's claim seed, they sign the proof-of-delivery message at the
 * committed location; the carrier turns that signature into the A1 proof.
 *
 * Command:
 *   sign-pod --packet <path> --id <n> --carrier-commit <decimal> \
 *            --lat <deg> --lon <deg> [--ts <unix>]
 *     → derives the EdDSA key from the packet claim seed, computes cell_rd via
 *       the geocell Morton mapping, signs
 *       pod_msg = Poseidon(DOM_PODMSG, id, carrier_commit, cell_rd, ts),
 *       and writes out/ships/<id>/pod.json {R8x,R8y,S,ts,lat_q,lon_q} (decimals).
 */
/** Baby Jubjub public key (decimal strings) for an EdDSA seed (hex). */
export declare function deriveRecipientKey(seedHex: string): Promise<{
    pkX: string;
    pkY: string;
}>;
export interface Pod {
    R8x: string;
    R8y: string;
    S: string;
    ts: string;
    lat_q: string;
    lon_q: string;
}
/**
 * Sign the proof-of-delivery message with the recipient claim key.
 * Reproduces gen-delivery-fixtures.mjs bit-for-bit for the pinned identities.
 */
export declare function signPod(args: {
    claimSeedHex: string;
    shipmentId: string | number | bigint;
    carrierPkCommit: string;
    latQ: bigint | string;
    lonQ: bigint | string;
    ts: string | number | bigint;
}): Promise<Pod>;
