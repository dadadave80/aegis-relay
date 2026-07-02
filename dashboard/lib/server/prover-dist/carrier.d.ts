/**
 * carrier.ts — carrier operator CLI (DESIGN.md §8.2, §8.4; actor "Carrier").
 *
 * Commands:
 *   verify-packet --packet <path> [--onchain-cs <decimal>]
 *       Recompute C_S from the packet opening and compare it to the on-chain
 *       commitment. This is the carrier's protection against a garbage-C_S
 *       merchant (T12) — on by default; acceptance advice is REFUSED on any
 *       mismatch. Without a registry id / --onchain-cs it verifies only
 *       internal consistency (opening → c_s, region root).
 *
 *   accept --packet <path> --payout <G...> [--registry <C...>]
 *       Derive/persist the carrier's Baby Jubjub key (CARRIER_EDDSA_SEED_HEX
 *       or a fresh random seed in out/carrier-key.json), compute
 *       carrier_pk_commit = Poseidon(DOM_PKC, pk_x, pk_y, pk_blind), stamp it
 *       back into the packet, and print/run the `accept` invoke.
 *
 *   prove-delivery --packet <path> --id <n> --pod <pod.json>
 *       Assemble the A1 witness EXACTLY as gen-delivery-fixtures.mjs, run
 *       snarkjs groth16 fullProve against the local zkey/wasm, write
 *       out/ships/<id>/{proof,public}.json.
 *
 *   deliver --id <n> [--registry <C...>]
 *       Encode out/ships/<id>/proof.json + public.json into the `deliver`
 *       invoke (proofToInvokeJson) and print/run it.
 */
import { type ShipmentOpening } from './lib/poseidon.js';
import { type CsOpening, type Packet } from './lib/packet.js';
import type { Pod } from './recipient.js';
import type { SnarkjsProof } from './lib/bn254.js';
/** Map a wire CsOpening (snake_case decimals) into computeCS's ShipmentOpening. */
export declare function openingToShipment(o: CsOpening): ShipmentOpening;
export interface CarrierKey {
    seedHex: string;
    pkX: string;
    pkY: string;
    pkBlind: string;
}
/**
 * Sample a full-width 251-bit field salt from the CSPRNG (DESIGN.md §5.1):
 * mask 32 random bytes to 251 bits → uniform in [0, 2^251), guaranteed below
 * BN254's scalar modulus r (~2^254), so it is always a valid field element.
 */
export declare function sampleFieldSalt(): string;
/**
 * Derive the carrier Baby Jubjub key and persist it (seed + pk + pk_blind) to
 * out/carrier-key.json. Seed comes from CARRIER_EDDSA_SEED_HEX or, failing
 * that, the persisted file, or a fresh random 32-byte seed.
 */
export declare function loadOrCreateCarrierKey(): Promise<CarrierKey>;
export declare function carrierPkCommit(key: CarrierKey): Promise<string>;
export interface PacketVerifyResult {
    computedCs: string;
    packetCs: string;
    onchainCs?: string;
    /** computedCs === packet.c_s */
    openingConsistent: boolean;
    /** opening.dest_region_root === dest_region.root */
    regionConsistent: boolean;
    /** computedCs === onchainCs (only when onchainCs supplied) */
    onchainMatch?: boolean;
    /** all applicable checks pass */
    ok: boolean;
}
export declare function verifyPacket(packet: Packet, onchainCs?: string): Promise<PacketVerifyResult>;
/** The A1 delivery witness object; keys mirror circuits/fixtures/delivery/input.json. */
export type DeliveryWitness = Record<string, string | string[]>;
export declare function assembleDeliveryWitness(args: {
    packet: Packet;
    carrierPkX: string;
    carrierPkY: string;
    pkBlind: string;
    pod: Pod;
    shipmentId: string | number | bigint;
}): Promise<DeliveryWitness>;
/**
 * accept(id: u64, carrier: Address, payout: Address, carrier_pk_commit: U256)
 *   --id <n> --carrier <G...> --payout <G...> --carrier_pk_commit <decimal>
 * Source = carrier (carrier.require_auth()).
 */
export declare function buildAcceptInvoke(args: {
    registryId: string;
    id: string;
    carrier: string;
    payout: string;
    carrierPkCommit: string;
    source?: string;
}): string[];
/**
 * deliver(id: u64, proof: Proof, nullifier: U256, ts: u64)
 *   --id <n>
 *   --proof '{"a":"<128hex>","b":"<256hex>","c":"<128hex>"}'   (BytesN as hex)
 *   --nullifier <decimal> --ts <unix>
 * Permissionless on-chain (no require_auth); source pays the fee (relay-carrier).
 */
export declare function buildDeliverInvoke(args: {
    registryId: string;
    id: string;
    proof: SnarkjsProof;
    nullifier: string;
    ts: string;
    source?: string;
}): string[];
