/**
 * poseidon.test.ts — poseidon.ts helpers vs fixtures/parity.json.
 *
 * The fixture is the shared truth: the same expected decimals are pinned in
 * contracts/aegis-common tests and asserted by circuits/test/parity.test.mjs.
 * Regenerate with prover/scripts/gen-parity.mjs (never hand-edit).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PAD } from './constants.js';
import {
  pad,
  pkCommit,
  custodyHead,
  computeCS,
  nullifier,
  credLeaf,
  cellLeaf,
  podMsg,
  flightDigest,
  poseidonHash,
} from './poseidon.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../../fixtures/parity.json'), 'utf8'),
);
const S = fixture.structures;

test('PAD constant matches fixture and live Poseidon(0,0)', async () => {
  assert.equal(PAD, fixture.constants.PAD);
  assert.equal(await pad(), S.pad.expected);
  assert.equal(PAD, S.pad.expected);
});

test('pkCommit matches fixture', async () => {
  const { pk_x, pk_y, pk_blind } = S.pk_commit.inputs;
  assert.equal(await pkCommit(pk_x, pk_y, pk_blind), S.pk_commit.expected);
});

test('custodyHead (nested arity-2) matches fixture', async () => {
  const { shipment_id, carrier_pk_commit } = S.custody_head.inputs;
  assert.equal(await custodyHead(shipment_id, carrier_pk_commit), S.custody_head.expected);
});

test('computeCS (12-input shipment commitment) matches fixture', async () => {
  const i = S.c_s.inputs;
  const cs = await computeCS({
    skuHash: i.sku_hash,
    qty: i.qty,
    weightG: i.weight_g,
    valueUnits: i.value_units,
    originCell: i.origin_cell,
    destRegionRoot: i.dest_region_root,
    recipientPkX: i.recipient_pk_x,
    recipientPkY: i.recipient_pk_y,
    method: i.method,
    deadlineTs: i.deadline_ts,
    shipmentSecret: i.shipment_secret,
  });
  assert.equal(cs, S.c_s.expected);
});

test('nullifier matches fixture', async () => {
  assert.equal(await nullifier(S.nullifier.inputs.shipment_secret), S.nullifier.expected);
});

test('credLeaf matches fixture', async () => {
  const i = S.cred_leaf.inputs;
  assert.equal(
    await credLeaf(i.pk_x, i.pk_y, i.cred_class, i.payload_limit_g, i.expiry_ts),
    S.cred_leaf.expected,
  );
});

test('cellLeaf matches fixture', async () => {
  assert.equal(await cellLeaf(S.cell_leaf.inputs.cell_id), S.cell_leaf.expected);
});

test('podMsg matches fixture', async () => {
  const i = S.pod_msg.inputs;
  assert.equal(
    await podMsg(i.shipment_id, i.carrier_pk_commit, i.cell_rd, i.ts),
    S.pod_msg.expected,
  );
});

test('flightDigest d0/d1/d2 match fixture', async () => {
  const i = S.flight_digest.inputs;
  const waypoints = i.waypoints.map(
    (w: { lat_q: string; lon_q: string; alt_dm: string; t: string }) => ({
      latQ: w.lat_q,
      lonQ: w.lon_q,
      altDm: w.alt_dm,
      t: w.t,
    }),
  );
  const [d0, d1, d2] = await flightDigest(i.shipment_id, waypoints);
  assert.equal(d0, S.flight_digest.expected.d0);
  assert.equal(d1, S.flight_digest.expected.d1);
  assert.equal(d2, S.flight_digest.expected.d2);
});

test('merkle4 root (pairwise poseidon2, even index = left, PAD fill) matches fixture', async () => {
  const [l0, l1, l2] = S.merkle4_root.inputs.leaves;
  const left = await poseidonHash([l0, l1]);
  const right = await poseidonHash([l2, PAD]);
  assert.equal(await poseidonHash([left, right]), S.merkle4_root.expected);
});
