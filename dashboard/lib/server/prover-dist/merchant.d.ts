/**
 * merchant.ts — merchant operator CLI (DESIGN.md §8.1; actor "Merchant").
 *
 * Commands:
 *   create --to-lat <deg> --to-lon <deg> --amount <i128> --deadline-hours <n> \
 *          [--method courier|drone] [--lane <u32>] [--id <n>] [--registry <C...>]
 *       Sample shipment_secret + salts from the CSPRNG (251-bit reduction —
 *       see sampleFieldSalt), generate the recipient EdDSA claim seed, compute
 *       C_S (lib/poseidon), build the 3×3 destination-region tree (lib/tree),
 *       write the plaintext packet (+ a sealed copy for the encrypted beat),
 *       and print/run the create_shipment invoke.
 *
 *   refund --id <n> [--registry <C...>]
 *       Print/run the permissionless refund_expired invoke.
 */
import { type Packet } from './lib/packet.js';
export interface BuildShipmentParams {
    toLat: string;
    toLon: string;
    amount: string;
    deadlineHours: number;
    method?: 'courier' | 'drone';
    laneId?: number;
    fromLat?: string;
    fromLon?: string;
    sku?: string;
    qty?: string;
    weightG?: string;
    valueUnits?: string;
    /** Override "now" (unix seconds) for deterministic behaviour. */
    nowSec?: number;
}
export interface BuiltShipment {
    packet: Packet;
    /** Coarse, day-rounded on-chain deadline (DESIGN.md §6.1). */
    escrowDeadline: string;
    /** Method variant name for the invoke enum arg. */
    method: 'Courier' | 'Drone';
    amount: string;
}
export declare function buildShipment(p: BuildShipmentParams): Promise<BuiltShipment>;
/**
 * create_shipment(merchant: Address, c_s: U256, token: Address, amount: i128,
 *   milestones: Vec<u32>, escrow_deadline: u64, method: Method, rail: Rail,
 *   lane_id: Option<u32>)
 *
 *   --merchant <G...> --c_s <decimal> --token <C...> --amount <i128>
 *   --milestones '[10000]' --escrow_deadline <unix> --method Courier
 *   --rail Transparent [--lane_id <u32>]     (lane_id omitted = Option None)
 * Source = merchant (merchant.require_auth()).
 */
export declare function buildCreateInvoke(args: {
    registryId: string;
    merchant: string;
    cs: string;
    token: string;
    amount: string;
    milestones: string;
    escrowDeadline: string;
    method: 'Courier' | 'Drone';
    laneId?: number;
    source?: string;
}): string[];
/**
 * refund_expired(id: u64)   --id <n>
 * Permissionless; source pays the fee (relay-merchant).
 */
export declare function buildRefundInvoke(args: {
    registryId: string;
    id: string;
    source?: string;
}): string[];
