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

import { buildEddsa } from 'circomlibjs';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// circuits/build (delivery_js + delivery_final.zkey) lives at the repo root,
// two levels up from prover/src.
const PROVER_CIRCUITS = resolve(dirname(fileURLToPath(import.meta.url)), '../../circuits/build');

import { RD_RES } from './lib/constants.js';
import { computeCS, custodyHead, nullifier, pkCommit, type ShipmentOpening } from './lib/poseidon.js';
import { mortonCell } from './lib/tree.js';
import {
  buildInvoke,
  parseFlags,
  proofToInvokeJson,
  resolveRegistryId,
  runInvoke,
  SOURCE,
  TESTNET,
  type InvokeArg,
} from './lib/contract.js';
import { OUT_ROOT, readPacket, writePacket, shipDir, type CsOpening, type Packet } from './lib/packet.js';
import type { Pod } from './recipient.js';
import type { SnarkjsProof } from './lib/bn254.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let eddsaInstance: any = null;
async function getEddsa() {
  if (eddsaInstance === null) eddsaInstance = await buildEddsa();
  return eddsaInstance;
}

// ── Shared conversion + key derivation ──────────────────────────────────────

/** Map a wire CsOpening (snake_case decimals) into computeCS's ShipmentOpening. */
export function openingToShipment(o: CsOpening): ShipmentOpening {
  return {
    skuHash: o.sku_hash,
    qty: o.qty,
    weightG: o.weight_g,
    valueUnits: o.value_units,
    originCell: o.origin_cell,
    destRegionRoot: o.dest_region_root,
    recipientPkX: o.recipient_pk_x,
    recipientPkY: o.recipient_pk_y,
    method: o.method,
    deadlineTs: o.deadline_ts,
    shipmentSecret: o.shipment_secret,
  };
}

export interface CarrierKey {
  seedHex: string;
  pkX: string;
  pkY: string;
  pkBlind: string;
}

const CARRIER_KEY_PATH = join(OUT_ROOT, 'carrier-key.json');

/**
 * Sample a full-width 251-bit field salt from the CSPRNG (DESIGN.md §5.1):
 * mask 32 random bytes to 251 bits → uniform in [0, 2^251), guaranteed below
 * BN254's scalar modulus r (~2^254), so it is always a valid field element.
 */
export function sampleFieldSalt(): string {
  let n = 0n;
  for (const b of crypto.randomBytes(32)) n = (n << 8n) | BigInt(b);
  n &= (1n << 251n) - 1n;
  return n.toString();
}

/**
 * Derive the carrier Baby Jubjub key and persist it (seed + pk + pk_blind) to
 * out/carrier-key.json. Seed comes from CARRIER_EDDSA_SEED_HEX or, failing
 * that, the persisted file, or a fresh random 32-byte seed.
 */
export async function loadOrCreateCarrierKey(): Promise<CarrierKey> {
  const eddsa = await getEddsa();
  const bjF = eddsa.babyJub.F;
  let seedHex = process.env.CARRIER_EDDSA_SEED_HEX;
  let pkBlind: string | undefined;
  if (!seedHex && existsSync(CARRIER_KEY_PATH)) {
    const prev = JSON.parse(readFileSync(CARRIER_KEY_PATH, 'utf8')) as CarrierKey;
    seedHex = prev.seedHex;
    pkBlind = prev.pkBlind;
  }
  if (!seedHex) seedHex = crypto.randomBytes(32).toString('hex');
  if (!pkBlind) pkBlind = sampleFieldSalt();

  const [x, y] = eddsa.prv2pub(Buffer.from(seedHex, 'hex'));
  const key: CarrierKey = {
    seedHex,
    pkX: bjF.toObject(x).toString(),
    pkY: bjF.toObject(y).toString(),
    pkBlind,
  };
  mkdirSync(OUT_ROOT, { recursive: true });
  writeFileSync(CARRIER_KEY_PATH, JSON.stringify(key, null, 2) + '\n');
  return key;
}

export async function carrierPkCommit(key: CarrierKey): Promise<string> {
  return pkCommit(key.pkX, key.pkY, key.pkBlind);
}

// ── verify-packet (T12) ─────────────────────────────────────────────────────

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

export async function verifyPacket(
  packet: Packet,
  onchainCs?: string,
): Promise<PacketVerifyResult> {
  const computedCs = await computeCS(openingToShipment(packet.cs_opening));
  const packetCs = BigInt(packet.c_s).toString();
  const openingConsistent = computedCs === packetCs;
  const regionConsistent = packet.cs_opening.dest_region_root === packet.dest_region.root;
  const normOnchain = onchainCs === undefined ? undefined : BigInt(onchainCs).toString();
  const onchainMatch = normOnchain === undefined ? undefined : computedCs === normOnchain;
  const ok = openingConsistent && regionConsistent && (onchainMatch ?? true);
  return {
    computedCs,
    packetCs,
    onchainCs: normOnchain,
    openingConsistent,
    regionConsistent,
    onchainMatch,
    ok,
  };
}

// ── A1 witness assembly (exact input.json reconstruction) ───────────────────

/** The A1 delivery witness object; keys mirror circuits/fixtures/delivery/input.json. */
export type DeliveryWitness = Record<string, string | string[]>;

export async function assembleDeliveryWitness(args: {
  packet: Packet;
  carrierPkX: string;
  carrierPkY: string;
  pkBlind: string;
  pod: Pod;
  shipmentId: string | number | bigint;
}): Promise<DeliveryWitness> {
  const { packet, carrierPkX, carrierPkY, pkBlind, pod } = args;
  const shipmentId = String(args.shipmentId);
  const o = packet.cs_opening;

  const carrierCommit = await pkCommit(carrierPkX, carrierPkY, pkBlind);
  const cs = await computeCS(openingToShipment(o));
  const head = await custodyHead(shipmentId, carrierCommit);
  const nul = await nullifier(o.shipment_secret);

  // Select the inclusion path for the DELIVERED cell (T13: must be in-region).
  const cellRd = mortonCell(BigInt(pod.lat_q), BigInt(pod.lon_q), RD_RES).toString();
  const gridIndex = packet.dest_region.cells.indexOf(cellRd);
  if (gridIndex < 0) {
    throw new Error(`delivery cell ${cellRd} is not inside the committed destination region`);
  }
  const path = packet.dest_region.paths[gridIndex];

  return {
    shipment_id: shipmentId,
    c_s: cs,
    head,
    nullifier: nul,
    ts: pod.ts,
    sku_hash: o.sku_hash,
    qty: o.qty,
    weight_g: o.weight_g,
    value_units: o.value_units,
    origin_cell: o.origin_cell,
    dest_region_root: o.dest_region_root,
    recipient_pk_x: o.recipient_pk_x,
    recipient_pk_y: o.recipient_pk_y,
    method: o.method,
    deadline_ts: o.deadline_ts,
    shipment_secret: o.shipment_secret,
    pk_x: carrierPkX,
    pk_y: carrierPkY,
    pk_blind: pkBlind,
    sig_R8x: pod.R8x,
    sig_R8y: pod.R8y,
    sig_S: pod.S,
    lat_q: pod.lat_q,
    lon_q: pod.lon_q,
    dest_path: path.pathElements,
    dest_path_index: path.pathIndices.map(String),
  };
}

// ── Invoke builders (documented JSON shapes) ────────────────────────────────

/**
 * accept(id: u64, carrier: Address, payout: Address, carrier_pk_commit: U256)
 *   --id <n> --carrier <G...> --payout <G...> --carrier_pk_commit <decimal>
 * Source = carrier (carrier.require_auth()).
 */
export function buildAcceptInvoke(args: {
  registryId: string;
  id: string;
  carrier: string;
  payout: string;
  carrierPkCommit: string;
  source?: string;
}): string[] {
  const invokeArgs: InvokeArg[] = [
    ['id', args.id],
    ['carrier', args.carrier],
    ['payout', args.payout],
    ['carrier_pk_commit', BigInt(args.carrierPkCommit).toString()],
  ];
  return buildInvoke({
    fn: 'accept',
    args: invokeArgs,
    source: args.source ?? SOURCE.carrier,
    registryId: args.registryId,
  });
}

/**
 * deliver(id: u64, proof: Proof, nullifier: U256, ts: u64)
 *   --id <n>
 *   --proof '{"a":"<128hex>","b":"<256hex>","c":"<128hex>"}'   (BytesN as hex)
 *   --nullifier <decimal> --ts <unix>
 * Permissionless on-chain (no require_auth); source pays the fee (relay-carrier).
 */
export function buildDeliverInvoke(args: {
  registryId: string;
  id: string;
  proof: SnarkjsProof;
  nullifier: string;
  ts: string;
  source?: string;
}): string[] {
  const proofJson = JSON.stringify(proofToInvokeJson(args.proof));
  const invokeArgs: InvokeArg[] = [
    ['id', args.id],
    ['proof', proofJson],
    ['nullifier', BigInt(args.nullifier).toString()],
    ['ts', args.ts],
  ];
  return buildInvoke({
    fn: 'deliver',
    args: invokeArgs,
    source: args.source ?? SOURCE.carrier,
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

async function cmdVerifyPacket(flags: Record<string, string>): Promise<void> {
  if (!flags.packet) throw new Error('usage: verify-packet --packet <path> [--onchain-cs <decimal>]');
  const packet = readPacket(flags.packet);
  const onchainCs = flags['onchain-cs'];
  const r = await verifyPacket(packet, onchainCs);
  console.log(`computed C_S : ${r.computedCs}`);
  console.log(`packet   C_S : ${r.packetCs}  (opening-consistent: ${r.openingConsistent})`);
  console.log(`region root  : consistent=${r.regionConsistent}`);
  if (r.onchainCs !== undefined) {
    console.log(`on-chain C_S : ${r.onchainCs}  (match: ${r.onchainMatch})`);
  } else {
    console.log('on-chain C_S : (none supplied — internal-consistency only)');
  }
  if (r.ok) {
    console.log('VERDICT: OK — packet opening matches the commitment. Safe to accept.');
  } else {
    console.log('VERDICT: MISMATCH — REFUSING acceptance advice (T12). Do NOT accept.');
    process.exit(2);
  }
}

async function cmdAccept(flags: Record<string, string>): Promise<void> {
  if (!flags.packet || !flags.payout) {
    throw new Error('usage: accept --packet <path> --payout <G...> [--registry <C...>]');
  }
  const packet = readPacket(flags.packet);
  const registryId = resolveRegistryId(flags.registry);

  // Safety: refuse to accept a packet whose opening does not match its own c_s.
  const v = await verifyPacket(packet, flags['onchain-cs']);
  if (!v.ok) {
    throw new Error('packet verify failed (T12) — refusing to accept; run verify-packet');
  }

  const key = await loadOrCreateCarrierKey();
  const commit = await carrierPkCommit(key);

  // Stamp carrier_pk_commit into the packet (opening ref for prove-delivery).
  packet.carrier_pk_commit = commit;
  if (packet.shipment_id) writePacket(packet.shipment_id, packet);

  const id = flags.id ?? packet.shipment_id;
  if (!id) throw new Error('shipment id unknown: pass --id or create the packet with one');

  const argv = buildAcceptInvoke({
    registryId: registryId ?? 'AEGIS_REGISTRY_ID',
    id: String(id),
    carrier: flags.carrier ?? TESTNET.carrier,
    payout: flags.payout,
    carrierPkCommit: commit,
  });
  console.log(`carrier_pk_commit = ${commit}`);
  printOrRun(argv, registryId);
}

async function cmdProveDelivery(flags: Record<string, string>): Promise<void> {
  if (!flags.packet || !flags.id || !flags.pod) {
    throw new Error('usage: prove-delivery --packet <path> --id <n> --pod <pod.json>');
  }
  const packet = readPacket(flags.packet);
  const pod = JSON.parse(readFileSync(flags.pod, 'utf8')) as Pod;
  const key = await loadOrCreateCarrierKey();

  const witness = await assembleDeliveryWitness({
    packet,
    carrierPkX: key.pkX,
    carrierPkY: key.pkY,
    pkBlind: key.pkBlind,
    pod,
    shipmentId: flags.id,
  });

  const dir = shipDir(flags.id);
  const inputPath = join(dir, 'input.json');
  writeFileSync(inputPath, JSON.stringify(witness, null, 2) + '\n');

  // Local proving artifacts (gitignored but present).
  const wasm = join(PROVER_CIRCUITS, 'delivery_js', 'delivery.wasm');
  const zkey = join(PROVER_CIRCUITS, 'delivery_final.zkey');
  if (!existsSync(wasm) || !existsSync(zkey)) {
    throw new Error(`missing proving artifacts:\n  ${wasm}\n  ${zkey}\n(run circuits/build.mjs)`);
  }

  const { groth16 } = await import('snarkjs');
  console.log('Proving A1 delivery (snarkjs groth16 fullProve)…');
  const { proof, publicSignals } = await groth16.fullProve(witness, wasm, zkey);

  const proofPath = join(dir, 'proof.json');
  const publicPath = join(dir, 'public.json');
  writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n');
  writeFileSync(publicPath, JSON.stringify(publicSignals, null, 2) + '\n');
  console.log(`Written: ${inputPath}`);
  console.log(`Written: ${proofPath}`);
  console.log(`Written: ${publicPath}`);
  console.log(`public signals [shipment_id,c_s,head,nullifier,ts]: ${JSON.stringify(publicSignals)}`);
}

async function cmdDeliver(flags: Record<string, string>): Promise<void> {
  if (!flags.id) throw new Error('usage: deliver --id <n> [--registry <C...>]');
  const registryId = resolveRegistryId(flags.registry);
  const dir = shipDir(flags.id);
  const proof = JSON.parse(readFileSync(join(dir, 'proof.json'), 'utf8')) as SnarkjsProof;
  const publicSignals = JSON.parse(readFileSync(join(dir, 'public.json'), 'utf8')) as string[];
  // public order: [shipment_id, c_s, head, nullifier, ts]
  const nul = BigInt(publicSignals[3]).toString();
  const ts = BigInt(publicSignals[4]).toString();

  const argv = buildDeliverInvoke({
    registryId: registryId ?? 'AEGIS_REGISTRY_ID',
    id: String(flags.id),
    proof,
    nullifier: nul,
    ts,
  });
  printOrRun(argv, registryId);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  switch (command) {
    case 'verify-packet':
      await cmdVerifyPacket(flags);
      break;
    case 'accept':
      await cmdAccept(flags);
      break;
    case 'prove-delivery':
      await cmdProveDelivery(flags);
      break;
    case 'deliver':
      await cmdDeliver(flags);
      break;
    default:
      console.error('carrier commands: verify-packet | accept | prove-delivery | deliver');
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
