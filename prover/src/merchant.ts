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

import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { METHOD_COURIER, METHOD_DRONE, RC_RES } from './lib/constants.js';
import { computeCS, poseidonHash } from './lib/poseidon.js';
import { buildDestRegionTree, latToQ, lonToQ, mortonCell } from './lib/tree.js';
import {
  buildInvoke,
  parseFlags,
  resolveRegistryId,
  runInvoke,
  SOURCE,
  TESTNET,
  type InvokeArg,
} from './lib/contract.js';
import {
  generatePacketKeypair,
  PACKET_VERSION,
  shipDir,
  writePacket,
  writeSealedPacket,
  type CsOpening,
  type Packet,
} from './lib/packet.js';
import { openingToShipment, sampleFieldSalt } from './carrier.js';
import { deriveRecipientKey } from './recipient.js';

// ── Shipment construction ───────────────────────────────────────────────────

export interface BuildShipmentParams {
  toLat: string;
  toLon: string;
  amount: string; // i128 escrow, decimal
  deadlineHours: number;
  method?: 'courier' | 'drone';
  laneId?: number;
  fromLat?: string;
  fromLon?: string;
  sku?: string; // preimage for sku_hash = Poseidon([sku])
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

const DAY = 86_400;

export async function buildShipment(p: BuildShipmentParams): Promise<BuiltShipment> {
  const now = p.nowSec ?? Math.floor(Date.now() / 1000);
  const methodName = p.method === 'drone' ? 'Drone' : 'Courier';
  const methodNum = p.method === 'drone' ? METHOD_DRONE : METHOD_COURIER;

  // Recipient claim: fresh Baby Jubjub seed, committed by public key in C_S.
  const recipientSeedHex = crypto.randomBytes(32).toString('hex');
  const { pkX, pkY } = await deriveRecipientKey(recipientSeedHex);

  // Destination region (privacy dial): 3×3 RD-cell grid → depth-6 padded tree.
  const latQ = latToQ(p.toLat);
  const lonQ = lonToQ(p.toLon);
  const destRegion = await buildDestRegionTree(latQ, lonQ);

  // Origin cell (RC-res). Defaults to the destination location for the demo.
  const fromLatQ = p.fromLat ? latToQ(p.fromLat) : latQ;
  const fromLonQ = p.fromLon ? lonToQ(p.fromLon) : lonQ;
  const originCell = mortonCell(fromLatQ, fromLonQ, RC_RES).toString();

  const shipmentSecret = sampleFieldSalt();
  const skuHash = await poseidonHash([BigInt(p.sku ?? '777')]);

  // Private fine-grained deadline vs. coarse public one (day granularity) —
  // deliberately coarsened so refund works without leaking the exact deadline.
  const deadlineTsPrivate = (now + p.deadlineHours * 3600).toString();
  const escrowDeadline = (Math.ceil((now + p.deadlineHours * 3600) / DAY) * DAY).toString();

  const opening: CsOpening = {
    sku_hash: skuHash,
    qty: p.qty ?? '1',
    weight_g: p.weightG ?? '1000',
    value_units: p.valueUnits ?? '1000000',
    origin_cell: originCell,
    dest_region_root: destRegion.root,
    recipient_pk_x: pkX,
    recipient_pk_y: pkY,
    method: String(methodNum),
    deadline_ts: deadlineTsPrivate,
    shipment_secret: shipmentSecret,
  };
  const cs = await computeCS(openingToShipment(opening));

  const packet: Packet = {
    version: PACKET_VERSION,
    c_s: cs,
    cs_opening: opening,
    dest_region: { cells: destRegion.cells, root: destRegion.root, paths: destRegion.paths },
    recipient_claim: { eddsa_seed_hex: recipientSeedHex },
    lane_id: p.laneId,
    corridor_ref: p.laneId !== undefined ? `lane-${p.laneId}` : undefined,
  };

  return { packet, escrowDeadline, method: methodName, amount: p.amount };
}

// ── Invoke builders (documented JSON shapes) ────────────────────────────────

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
export function buildCreateInvoke(args: {
  registryId: string;
  merchant: string;
  cs: string;
  token: string;
  amount: string;
  milestones: string; // JSON array, e.g. "[10000]"
  escrowDeadline: string;
  method: 'Courier' | 'Drone';
  laneId?: number;
  source?: string;
}): string[] {
  const invokeArgs: InvokeArg[] = [
    ['merchant', args.merchant],
    ['c_s', BigInt(args.cs).toString()],
    ['token', args.token],
    ['amount', args.amount],
    ['milestones', args.milestones],
    ['escrow_deadline', args.escrowDeadline],
    // Method/Rail carry explicit integer discriminants, so the contract spec
    // exposes them as u32 enums — the invoke arg is the number, not the name.
    ['method', args.method === 'Drone' ? '3' : '1'],
    ['rail', '0'],
    ['lane_id', args.laneId === undefined ? undefined : String(args.laneId)],
  ];
  return buildInvoke({
    fn: 'create_shipment',
    args: invokeArgs,
    source: args.source ?? SOURCE.merchant,
    registryId: args.registryId,
  });
}

/**
 * refund_expired(id: u64)   --id <n>
 * Permissionless; source pays the fee (relay-merchant).
 */
export function buildRefundInvoke(args: { registryId: string; id: string; source?: string }): string[] {
  return buildInvoke({
    fn: 'refund_expired',
    args: [['id', args.id]],
    source: args.source ?? SOURCE.merchant,
    registryId: args.registryId,
  });
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function printOrRun(argv: string[], registryId: string | undefined): void {
  if (registryId) {
    console.log(`Submitting: ${argv.join(' ')}`);
    const res = runInvoke(argv);
    console.log(res.stdout.trim());
  } else {
    console.log('(AEGIS_REGISTRY_ID unset — printing invoke, not submitting)');
    console.log(argv.join(' '));
  }
}

async function cmdCreate(flags: Record<string, string>): Promise<void> {
  if (flags['to-lat'] === undefined || flags['to-lon'] === undefined || !flags.amount || !flags['deadline-hours']) {
    throw new Error(
      'usage: create --to-lat <deg> --to-lon <deg> --amount <i128> --deadline-hours <n> [--method courier|drone] [--lane <u32>] [--id <n>]',
    );
  }
  const method = (flags.method as 'courier' | 'drone' | undefined) ?? 'courier';
  const laneId = flags.lane !== undefined ? Number(flags.lane) : undefined;
  const built = await buildShipment({
    toLat: flags['to-lat'],
    toLon: flags['to-lon'],
    amount: flags.amount,
    deadlineHours: Number(flags['deadline-hours']),
    method,
    laneId,
  });

  const id = flags.id ?? 'draft';
  built.packet.shipment_id = flags.id;
  const packetPath = writePacket(id, built.packet);

  // Encrypted beat: seal a copy to a fresh demo X25519 recipient key, storing
  // the keypair alongside so the demo can open packet.sealed.
  const kp = generatePacketKeypair();
  const sealedPath = writeSealedPacket(id, kp.publicKeyPem, built.packet);
  writeFileSync(join(shipDir(id), 'packet-keys.json'), JSON.stringify(kp, null, 2) + '\n');

  console.log(`C_S              = ${built.packet.c_s}`);
  console.log(`dest_region_root = ${built.packet.dest_region.root}`);
  console.log(`Written: ${packetPath}`);
  console.log(`Written: ${sealedPath}  (+ packet-keys.json)`);

  const registryId = resolveRegistryId(flags.registry);
  const argv = buildCreateInvoke({
    registryId: registryId ?? 'AEGIS_REGISTRY_ID',
    merchant: flags.merchant ?? TESTNET.merchant,
    cs: built.packet.c_s,
    token: flags.token ?? TESTNET.nativeSac,
    amount: built.amount,
    milestones: flags.milestones ?? '[10000]',
    escrowDeadline: built.escrowDeadline,
    method: built.method,
    laneId,
  });
  printOrRun(argv, registryId);
}

async function cmdRefund(flags: Record<string, string>): Promise<void> {
  if (!flags.id) throw new Error('usage: refund --id <n> [--registry <C...>]');
  const registryId = resolveRegistryId(flags.registry);
  const argv = buildRefundInvoke({ registryId: registryId ?? 'AEGIS_REGISTRY_ID', id: String(flags.id) });
  printOrRun(argv, registryId);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  switch (command) {
    case 'create':
      await cmdCreate(flags);
      break;
    case 'refund':
      await cmdRefund(flags);
      break;
    default:
      console.error('merchant commands: create | refund');
      process.exit(1);
  }
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  });
}
