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

import { buildEddsa } from 'circomlibjs';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { RD_RES } from './lib/constants.js';
import { podMsg } from './lib/poseidon.js';
import { mortonCell, latLonToQ } from './lib/tree.js';
import { parseFlags } from './lib/contract.js';
import { readPacket, shipDir } from './lib/packet.js';

// circomlibjs eddsa instance is async + heavy; build once.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let eddsaInstance: any = null;
async function getEddsa() {
  if (eddsaInstance === null) eddsaInstance = await buildEddsa();
  return eddsaInstance;
}

/** Baby Jubjub public key (decimal strings) for an EdDSA seed (hex). */
export async function deriveRecipientKey(
  seedHex: string,
): Promise<{ pkX: string; pkY: string }> {
  const eddsa = await getEddsa();
  const bjF = eddsa.babyJub.F;
  const [x, y] = eddsa.prv2pub(Buffer.from(seedHex, 'hex'));
  return { pkX: bjF.toObject(x).toString(), pkY: bjF.toObject(y).toString() };
}

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
export async function signPod(args: {
  claimSeedHex: string;
  shipmentId: string | number | bigint;
  carrierPkCommit: string;
  latQ: bigint | string;
  lonQ: bigint | string;
  ts: string | number | bigint;
}): Promise<Pod> {
  const eddsa = await getEddsa();
  const bjF = eddsa.babyJub.F;
  const seed = Buffer.from(args.claimSeedHex, 'hex');
  const latQ = BigInt(args.latQ);
  const lonQ = BigInt(args.lonQ);
  const cellRd = mortonCell(latQ, lonQ, RD_RES);
  const msgDec = await podMsg(String(args.shipmentId), args.carrierPkCommit, cellRd.toString(), String(args.ts));
  const sig = eddsa.signPoseidon(seed, bjF.e(BigInt(msgDec)));
  return {
    R8x: bjF.toObject(sig.R8[0]).toString(),
    R8y: bjF.toObject(sig.R8[1]).toString(),
    S: sig.S.toString(),
    ts: String(args.ts),
    lat_q: latQ.toString(),
    lon_q: lonQ.toString(),
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function cmdSignPod(flags: Record<string, string>): Promise<void> {
  const packetPath = flags.packet;
  const id = flags.id;
  const carrierCommit = flags['carrier-commit'];
  if (!packetPath || !id || !carrierCommit || flags.lat === undefined || flags.lon === undefined) {
    throw new Error(
      'usage: sign-pod --packet <path> --id <n> --carrier-commit <decimal> --lat <deg> --lon <deg> [--ts <unix>]',
    );
  }
  const packet = readPacket(packetPath);
  const { latQ, lonQ } = latLonToQ(flags.lat, flags.lon);
  const ts = flags.ts ?? String(Math.floor(Date.now() / 1000));

  const pod = await signPod({
    claimSeedHex: packet.recipient_claim.eddsa_seed_hex,
    shipmentId: id,
    carrierPkCommit: BigInt(carrierCommit).toString(),
    latQ,
    lonQ,
    ts,
  });

  const path = join(shipDir(id), 'pod.json');
  writeFileSync(path, JSON.stringify(pod, null, 2) + '\n');
  console.log(`Signed PoD for shipment ${id} at cell ${mortonCell(latQ, lonQ, RD_RES)}`);
  console.log(`Written: ${path}`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  switch (command) {
    case 'sign-pod':
      await cmdSignPod(flags);
      break;
    default:
      console.error('recipient commands: sign-pod');
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
