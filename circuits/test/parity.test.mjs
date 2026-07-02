#!/usr/bin/env node
/**
 * parity.test.mjs — circuit-side parity check against fixtures/parity.json.
 *
 * Pipeline (run with plain `node circuits/test/parity.test.mjs` from the repo
 * root; also works from anywhere — paths are derived from this file):
 *   1. compile circuits/test/parity.circom via circuits/build.mjs
 *   2. assemble the witness input from the fixture's raw sample inputs
 *   3. generate the witness via circuits/build.mjs
 *   4. assert every circuit output equals the fixture's expected decimal
 *
 * Output signal → witness index mapping is read from the .sym file (never
 * assume declaration order survives the compiler).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const BUILD_MJS = join(REPO_ROOT, 'circuits/build.mjs');
const CIRCUIT = join(REPO_ROOT, 'circuits/test/parity.circom');
const OUTDIR = join(REPO_ROOT, 'circuits/build');

// snarkjs lives in circuits/node_modules (CJS entry — use require).
const require = createRequire(import.meta.url);
const snarkjs = require('snarkjs');

const fixture = JSON.parse(readFileSync(join(REPO_ROOT, 'fixtures/parity.json'), 'utf8'));
const S = fixture.structures;

// ── 1. compile ───────────────────────────────────────────────────────────────
function run(args) {
  const res = spawnSync('node', [BUILD_MJS, ...args], { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`build.mjs ${args[0]} failed (exit ${res.status})`);
    process.exit(1);
  }
}
run(['compile', CIRCUIT, OUTDIR]);

// ── 2. witness input from fixture raw samples ────────────────────────────────
const wp = S.flight_digest.inputs.waypoints;
const input = {
  pk_x: S.pk_commit.inputs.pk_x,
  pk_y: S.pk_commit.inputs.pk_y,
  pk_blind: S.pk_commit.inputs.pk_blind,
  shipment_id: S.custody_head.inputs.shipment_id,
  ...S.c_s.inputs, // sku_hash … shipment_secret (keys match circuit signals)
  cred_class: S.cred_leaf.inputs.cred_class,
  payload_limit_g: S.cred_leaf.inputs.payload_limit_g,
  expiry_ts: S.cred_leaf.inputs.expiry_ts,
  cell_id: S.cell_leaf.inputs.cell_id,
  cell_rd: S.pod_msg.inputs.cell_rd,
  pod_ts: S.pod_msg.inputs.ts,
  lat_q: wp.map((w) => w.lat_q),
  lon_q: wp.map((w) => w.lon_q),
  alt_dm: wp.map((w) => w.alt_dm),
  t: wp.map((w) => w.t),
};
mkdirSync(OUTDIR, { recursive: true });
const inputPath = join(OUTDIR, 'parity_input.json');
writeFileSync(inputPath, JSON.stringify(input, null, 2));

// ── 3. witness ───────────────────────────────────────────────────────────────
const wtnsPath = join(OUTDIR, 'parity.wtns');
run(['witness', 'parity', inputPath, wtnsPath, OUTDIR]);

const witness = await snarkjs.wtns.exportJson(wtnsPath);

// Map main.<output> → witness index via the .sym file: "#s,#w,#c,name".
const outputIndex = new Map();
for (const line of readFileSync(join(OUTDIR, 'parity.sym'), 'utf8').split('\n')) {
  const [, w, , name] = line.split(',');
  if (name && name.startsWith('main.out_')) {
    outputIndex.set(name.slice('main.'.length), Number(w));
  }
}

function outValue(name) {
  const idx = outputIndex.get(name);
  assert.notEqual(idx, undefined, `output ${name} not found in parity.sym`);
  return witness[idx].toString();
}

// ── 4. assertions ────────────────────────────────────────────────────────────
const cases = [
  ['out_pk_commit', S.pk_commit.expected],
  ['out_custody_head', S.custody_head.expected],
  ['out_c_s', S.c_s.expected],
  ['out_nullifier', S.nullifier.expected],
  ['out_cred_leaf', S.cred_leaf.expected],
  ['out_cell_leaf', S.cell_leaf.expected],
  ['out_pod_msg', S.pod_msg.expected],
  ['out_flight_d2', S.flight_digest.expected.d2],
];

for (const [name, expected] of cases) {
  test(`${name} matches fixtures/parity.json`, () => {
    assert.equal(outValue(name), expected);
  });
}
