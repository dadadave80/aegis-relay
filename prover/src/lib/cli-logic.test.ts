/**
 * cli-logic.test.ts — the CLI's cryptographic code paths, pinned against the
 * frozen A1 delivery fixture (circuits/fixtures/delivery). No network; no proving.
 *
 * Coverage:
 *   - C_S recompute from input.json equals meta.json c_s
 *   - dest-region tree root from the 9 fixture cells equals the fixture root
 *   - FULL WITNESS RECONSTRUCTION: drive the carrier witness-assembly + the
 *     recipient sign-pod code paths with the fixture identities and deep-equal
 *     the result against input.json (bit-for-bit reproduction of the proven witness)
 *   - buildInvoke argv snapshots for create / accept / deliver
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeCS, pkCommit } from './poseidon.js';
import { buildDestRegionTree } from './tree.js';
import { proofToInvokeJson, SOURCE, TESTNET } from './contract.js';
import { PACKET_VERSION, type CsOpening, type Packet } from './packet.js';
import type { SnarkjsProof } from './bn254.js';
import {
  assembleDeliveryWitness,
  buildAcceptInvoke,
  buildDeliverInvoke,
  openingToShipment,
} from '../carrier.js';
import { deriveRecipientKey, signPod } from '../recipient.js';
import { buildCreateInvoke, buildRefundInvoke } from '../merchant.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXDIR = join(__dirname, '../../../circuits/fixtures/delivery');
const input = JSON.parse(readFileSync(join(FIXDIR, 'input.json'), 'utf8'));
const meta = JSON.parse(readFileSync(join(FIXDIR, 'meta.json'), 'utf8'));

/** The fixture C_S opening, in the packet's wire shape. */
const fixtureOpening: CsOpening = {
  sku_hash: input.sku_hash,
  qty: input.qty,
  weight_g: input.weight_g,
  value_units: input.value_units,
  origin_cell: input.origin_cell,
  dest_region_root: input.dest_region_root,
  recipient_pk_x: input.recipient_pk_x,
  recipient_pk_y: input.recipient_pk_y,
  method: input.method,
  deadline_ts: input.deadline_ts,
  shipment_secret: input.shipment_secret,
};

const seedHex = (first: number): string =>
  Buffer.from(Array.from({ length: 32 }, (_, i) => first + i)).toString('hex');
const CARRIER_SEED = seedHex(0x01);
const RECIPIENT_SEED = seedHex(0x21);

test('C_S recompute from input.json equals meta.json c_s', async () => {
  const cs = await computeCS(openingToShipment(fixtureOpening));
  assert.equal(cs, meta.c_s);
  assert.equal(cs, input.c_s);
});

test('dest-region tree root from the 9 fixture cells equals the fixture root', async () => {
  const region = await buildDestRegionTree(BigInt(input.lat_q), BigInt(input.lon_q));
  assert.equal(region.root, input.dest_region_root);
  assert.deepEqual(region.cells, meta.aux.grid_cells);
  assert.equal(region.centerIndex, meta.aux.leaf_index);
});

test('recipient sign-pod reproduces the fixture EdDSA signature', async () => {
  const carrier = await deriveRecipientKey(CARRIER_SEED);
  const commit = await pkCommit(carrier.pkX, carrier.pkY, input.pk_blind);
  assert.equal(commit, meta.carrier_pk_commit);

  const pod = await signPod({
    claimSeedHex: RECIPIENT_SEED,
    shipmentId: input.shipment_id,
    carrierPkCommit: commit,
    latQ: input.lat_q,
    lonQ: input.lon_q,
    ts: input.ts,
  });
  assert.equal(pod.R8x, input.sig_R8x);
  assert.equal(pod.R8y, input.sig_R8y);
  assert.equal(pod.S, input.sig_S);
});

test('FULL WITNESS RECONSTRUCTION deep-equals circuits/fixtures/delivery/input.json', async () => {
  // Recipient identity → Baby Jubjub key (must match the committed recipient).
  const recipient = await deriveRecipientKey(RECIPIENT_SEED);
  assert.equal(recipient.pkX, input.recipient_pk_x);
  assert.equal(recipient.pkY, input.recipient_pk_y);

  // Carrier identity → carrier_pk_commit opening (pk_blind pinned at 12345).
  const carrier = await deriveRecipientKey(CARRIER_SEED);
  assert.equal(carrier.pkX, input.pk_x);
  assert.equal(carrier.pkY, input.pk_y);
  const commit = await pkCommit(carrier.pkX, carrier.pkY, input.pk_blind);

  // Recipient signs the PoD at the committed cell (recipient code path).
  const pod = await signPod({
    claimSeedHex: RECIPIENT_SEED,
    shipmentId: input.shipment_id,
    carrierPkCommit: commit,
    latQ: input.lat_q,
    lonQ: input.lon_q,
    ts: input.ts,
  });

  // Merchant builds the destination-region tree the carrier reads from the packet.
  const region = await buildDestRegionTree(BigInt(input.lat_q), BigInt(input.lon_q));
  const packet: Packet = {
    version: PACKET_VERSION,
    shipment_id: input.shipment_id,
    c_s: meta.c_s,
    cs_opening: fixtureOpening,
    dest_region: { cells: region.cells, root: region.root, paths: region.paths },
    carrier_pk_commit: commit,
    recipient_claim: { eddsa_seed_hex: RECIPIENT_SEED },
  };

  // Carrier assembles the A1 witness (carrier code path).
  const witness = await assembleDeliveryWitness({
    packet,
    carrierPkX: carrier.pkX,
    carrierPkY: carrier.pkY,
    pkBlind: input.pk_blind,
    pod,
    shipmentId: input.shipment_id,
  });

  // Bit-for-bit reproduction of the proven witness.
  assert.deepEqual(witness, input);
});

// ── buildInvoke argv snapshots ──────────────────────────────────────────────

const REG = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

test('buildInvoke snapshot: create_shipment (courier, no lane)', () => {
  const argv = buildCreateInvoke({
    registryId: REG,
    merchant: TESTNET.merchant,
    cs: meta.c_s,
    token: TESTNET.nativeSac,
    amount: '1000000000',
    milestones: '[10000]',
    escrowDeadline: '1800086400',
    method: 'Courier',
  });
  assert.deepEqual(argv, [
    'stellar', 'contract', 'invoke',
    '--id', REG,
    '--source', SOURCE.merchant,
    '--network', 'testnet',
    '--', 'create_shipment',
    '--merchant', TESTNET.merchant,
    '--c_s', meta.c_s,
    '--token', TESTNET.nativeSac,
    '--amount', '1000000000',
    '--milestones', '[10000]',
    '--escrow_deadline', '1800086400',
    // u32-enum spec encoding (Method/Rail carry explicit discriminants)
    '--method', '1',
    '--rail', '0',
  ]);
});

test('buildInvoke snapshot: create_shipment (drone, with lane_id Some)', () => {
  const argv = buildCreateInvoke({
    registryId: REG,
    merchant: TESTNET.merchant,
    cs: '123',
    token: TESTNET.nativeSac,
    amount: '5',
    milestones: '[3000,7000]',
    escrowDeadline: '1800086400',
    method: 'Drone',
    laneId: 7,
  });
  assert.deepEqual(argv, [
    'stellar', 'contract', 'invoke',
    '--id', REG,
    '--source', SOURCE.merchant,
    '--network', 'testnet',
    '--', 'create_shipment',
    '--merchant', TESTNET.merchant,
    '--c_s', '123',
    '--token', TESTNET.nativeSac,
    '--amount', '5',
    '--milestones', '[3000,7000]',
    '--escrow_deadline', '1800086400',
    '--method', '3',
    '--rail', '0',
    '--lane_id', '7', // Option Some(7) — present; None would omit this flag
  ]);
});

test('buildInvoke snapshot: accept', () => {
  const argv = buildAcceptInvoke({
    registryId: REG,
    id: input.shipment_id,
    carrier: TESTNET.carrier,
    payout: TESTNET.carrier,
    carrierPkCommit: meta.carrier_pk_commit,
  });
  assert.deepEqual(argv, [
    'stellar', 'contract', 'invoke',
    '--id', REG,
    '--source', SOURCE.carrier,
    '--network', 'testnet',
    '--', 'accept',
    '--id', input.shipment_id,
    '--carrier', TESTNET.carrier,
    '--payout', TESTNET.carrier,
    '--carrier_pk_commit', meta.carrier_pk_commit,
  ]);
});

test('buildInvoke snapshot: deliver (proof BytesN as hex JSON)', () => {
  const proof = JSON.parse(readFileSync(join(FIXDIR, 'proof.json'), 'utf8')) as SnarkjsProof;
  const argv = buildDeliverInvoke({
    registryId: REG,
    id: input.shipment_id,
    proof,
    nullifier: meta.nullifier,
    ts: meta.ts,
  });
  const proofJson = JSON.stringify(proofToInvokeJson(proof));
  assert.deepEqual(argv, [
    'stellar', 'contract', 'invoke',
    '--id', REG,
    '--source', SOURCE.carrier,
    '--network', 'testnet',
    '--', 'deliver',
    '--id', input.shipment_id,
    '--proof', proofJson,
    '--nullifier', meta.nullifier,
    '--ts', meta.ts,
  ]);
  // Hex widths: a = BytesN<64> (128 hex), b = BytesN<128> (256 hex), c = 128 hex.
  const p = proofToInvokeJson(proof);
  assert.equal(p.a.length, 128);
  assert.equal(p.b.length, 256);
  assert.equal(p.c.length, 128);
});

test('buildInvoke snapshot: refund_expired', () => {
  const argv = buildRefundInvoke({ registryId: REG, id: input.shipment_id });
  assert.deepEqual(argv, [
    'stellar', 'contract', 'invoke',
    '--id', REG,
    '--source', SOURCE.merchant,
    '--network', 'testnet',
    '--', 'refund_expired',
    '--id', input.shipment_id,
  ]);
});
