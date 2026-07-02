#!/usr/bin/env node
/**
 * gen-delivery-fixtures.mjs — pinned witness/public fixtures for circuit A1
 * (circuits/delivery.circom) plus the Soroban test-fixture emitter.
 *
 * Phase 1 (always): computes the frozen honest delivery scenario and writes
 *   circuits/fixtures/delivery/input.json   (full witness input)
 *   circuits/fixtures/delivery/meta.json    (public values + carrier_pk_commit
 *                                            + aux values for tests/CLIs)
 *
 * Phase 2 (when circuits/fixtures/delivery/{proof,public,verification_key}.json
 * exist — i.e. after `build.mjs setup` + `build.mjs prove`): overwrites
 *   contracts/aegis-registry/src/test_fixtures.rs
 * with the byte-encoded proof/VK (encoding rules from prover/src/lib/bn254.ts:
 * G1 = BE32(x)||BE32(y); G2 = BE32(x_c1)||BE32(x_c0)||BE32(y_c1)||BE32(y_c0) —
 * imaginary limb FIRST, the v1-verified limb order).
 *
 * Scenario provenance (all FROZEN — the registry agent's tests pin on these):
 *   shipment_id     = 1;  ts = 1_800_000_000;  method = 1 (COURIER)
 *   carrier seed    = bytes 0x01..0x20   (same identity as fixtures/parity.json)
 *   recipient seed  = bytes 0x21..0x40   (same identity as fixtures/parity.json)
 *   pk_blind        = 12345
 *   recipient at lat 6.5244 N, lon 3.3792 E (Lagos):
 *     lat_q = floor((6.5244+90)/180 · 2^24)   — computed in exact integer math
 *     lon_q = floor((3.3792+180)/360 · 2^24)
 *   dest region     = 3×3 grid of r=17 cells centered on the recipient's cell,
 *                     leaves Poseidon(DOM_CELL, cell) in slots 0..8 of a
 *                     depth-6 (64-slot) PAD-filled tree, even index = left.
 *   C_S opening: sku_hash = Poseidon([777]), qty=2, weight_g=1500,
 *     value_units=1_000_000_000, origin_cell = r=15 cell of the same lat/lon,
 *     deadline_ts=1_800_080_000,
 *     shipment_secret = 987654321987654321987654321987654321
 *
 * Run: node prover/scripts/gen-delivery-fixtures.mjs   (from anywhere)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPoseidon, buildEddsa } from 'circomlibjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const FIXTURE_DIR = join(REPO_ROOT, 'circuits/fixtures/delivery');
const RUST_OUT = join(REPO_ROOT, 'contracts/aegis-registry/src/test_fixtures.rs');

// ── Normative constants (DESIGN §5.2/§5.4; parity with circuits/lib/constants.circom) ──
const DOM_SHIP = 1n;
const DOM_ACCEPT = 2n;
const DOM_PODMSG = 5n;
const DOM_NULL = 6n;
const DOM_PKC = 7n;
const DOM_CELL = 9n;
const RC_RES = 15;
const RD_RES = 17;
const DEST_DEPTH = 6;

// ── Frozen scenario values ───────────────────────────────────────────────────
const SHIPMENT_ID = 1n;
const TS = 1_800_000_000n;
const METHOD = 1n; // COURIER
const PK_BLIND = 12345n;
const QTY = 2n;
const WEIGHT_G = 1500n;
const VALUE_UNITS = 1_000_000_000n;
const DEADLINE_TS = 1_800_080_000n;
const SHIPMENT_SECRET = 987654321987654321987654321987654321n;

// lat 6.5244 N, lon 3.3792 E — exact integer math, no float rounding ambiguity:
// lat_q = floor((6.5244+90)/180 · 2^24) = floor(965244·2^24 / 1_800_000)
// lon_q = floor((3.3792+180)/360 · 2^24) = floor(1_833_792·2^24 / 3_600_000)
const LAT_Q = (965244n * 2n ** 24n) / 1800000n;
const LON_Q = (1833792n * 2n ** 24n) / 3600000n;

// ── Geometry helpers (NORMATIVE Morton mapping — circuits/lib/geocell.circom) ─
// cell = Σ_j lat_top_bit_j·2^(2j+1) + lon_top_bit_j·2^(2j), lat in ODD (higher)
// positions; top-r bits of the 24-bit coordinates.
function mortonFromTop(latTop, lonTop, r) {
  let cell = 0n;
  for (let j = 0n; j < BigInt(r); j++) {
    cell |= ((latTop >> j) & 1n) << (2n * j + 1n);
    cell |= ((lonTop >> j) & 1n) << (2n * j);
  }
  return cell;
}
const topBits = (q, r) => q >> BigInt(24 - r);
const mortonCell = (latQ, lonQ, r) => mortonFromTop(topBits(latQ, r), topBits(lonQ, r), r);

// ── Main ─────────────────────────────────────────────────────────────────────
const poseidon = await buildPoseidon();
const F = poseidon.F;
const P = (...inputs) => F.toObject(poseidon(inputs.map(BigInt)));
const h2 = (a, b) => P(a, b);
const PAD = h2(0n, 0n);

const eddsa = await buildEddsa();
const bjF = eddsa.babyJub.F;
const seed = (firstByte) => Buffer.from(Array.from({ length: 32 }, (_, i) => firstByte + i));
const carrierSeed = seed(0x01);
const recipientSeed = seed(0x21);
const [pk_x, pk_y] = eddsa.prv2pub(carrierSeed).map((c) => bjF.toObject(c));
const [recipient_pk_x, recipient_pk_y] = eddsa.prv2pub(recipientSeed).map((c) => bjF.toObject(c));

// Destination region: 3×3 r=17 grid centered on the recipient cell,
// dlat-major order → recipient's own cell lands at grid index 4.
const latTop = topBits(LAT_Q, RD_RES);
const lonTop = topBits(LON_Q, RD_RES);
const gridCells = [];
for (const dlat of [-1n, 0n, 1n]) {
  for (const dlon of [-1n, 0n, 1n]) {
    gridCells.push(mortonFromTop(latTop + dlat, lonTop + dlon, RD_RES));
  }
}
const LEAF_INDEX = 4;
const cell_rd = gridCells[LEAF_INDEX];
if (cell_rd !== mortonCell(LAT_Q, LON_Q, RD_RES)) throw new Error('grid center mismatch');

// Depth-6 tree: 64 slots, 9 real leaves then PAD fill; even index = left child
// (same builder convention as gen-parity.mjs merkle4 / poseidon-merkle).
const leaves = gridCells.map((c) => P(DOM_CELL, c));
while (leaves.length < 2 ** DEST_DEPTH) leaves.push(PAD);

function buildLevels(leafLevel) {
  const levels = [leafLevel];
  let cur = leafLevel;
  while (cur.length > 1) {
    const next = [];
    for (let i = 0; i < cur.length; i += 2) next.push(h2(cur[i], cur[i + 1]));
    levels.push(next);
    cur = next;
  }
  return levels;
}
function genPath(levels, index) {
  const pathElements = [];
  const pathIndices = [];
  let idx = index;
  for (let lvl = 0; lvl < levels.length - 1; lvl++) {
    const sib = (idx & 1) === 0 ? idx + 1 : idx - 1;
    pathElements.push(levels[lvl][sib]);
    pathIndices.push(idx & 1);
    idx >>= 1;
  }
  return { pathElements, pathIndices };
}

const levels = buildLevels(leaves);
const dest_region_root = levels[DEST_DEPTH][0];
const { pathElements: dest_path, pathIndices: dest_path_index } = genPath(levels, LEAF_INDEX);

// C_S opening
const sku_hash = P(777n);
const origin_cell = mortonCell(LAT_Q, LON_Q, RC_RES);
const c_s = P(
  DOM_SHIP, sku_hash, QTY, WEIGHT_G, VALUE_UNITS, origin_cell, dest_region_root,
  recipient_pk_x, recipient_pk_y, METHOD, DEADLINE_TS, SHIPMENT_SECRET,
);

// Custody head (nested arity-2, hard rule 7) + nullifier
const carrier_pk_commit = P(DOM_PKC, pk_x, pk_y, PK_BLIND);
const head = h2(h2(DOM_ACCEPT, SHIPMENT_ID), carrier_pk_commit);
const nullifier = P(DOM_NULL, SHIPMENT_SECRET);

// PoD message + recipient EdDSA-Poseidon signature (DESIGN §8.4)
const pod_msg = P(DOM_PODMSG, SHIPMENT_ID, carrier_pk_commit, cell_rd, TS);
const sig = eddsa.signPoseidon(recipientSeed, bjF.e(pod_msg));
if (!eddsa.verifyPoseidon(bjF.e(pod_msg), sig, eddsa.prv2pub(recipientSeed))) {
  throw new Error('self-check failed: recipient PoD signature does not verify');
}
const sig_R8x = bjF.toObject(sig.R8[0]);
const sig_R8y = bjF.toObject(sig.R8[1]);
const sig_S = sig.S; // already a bigint scalar

// ── Phase 1: emit input.json + meta.json ─────────────────────────────────────
const s = (v) => v.toString();
const input = {
  shipment_id: s(SHIPMENT_ID),
  c_s: s(c_s),
  head: s(head),
  nullifier: s(nullifier),
  ts: s(TS),
  sku_hash: s(sku_hash),
  qty: s(QTY),
  weight_g: s(WEIGHT_G),
  value_units: s(VALUE_UNITS),
  origin_cell: s(origin_cell),
  dest_region_root: s(dest_region_root),
  recipient_pk_x: s(recipient_pk_x),
  recipient_pk_y: s(recipient_pk_y),
  method: s(METHOD),
  deadline_ts: s(DEADLINE_TS),
  shipment_secret: s(SHIPMENT_SECRET),
  pk_x: s(pk_x),
  pk_y: s(pk_y),
  pk_blind: s(PK_BLIND),
  sig_R8x: s(sig_R8x),
  sig_R8y: s(sig_R8y),
  sig_S: s(sig_S),
  lat_q: s(LAT_Q),
  lon_q: s(LON_Q),
  dest_path: dest_path.map(s),
  dest_path_index: dest_path_index.map(s),
};

const meta = {
  _comment:
    'AUTO-GENERATED by prover/scripts/gen-delivery-fixtures.mjs — DO NOT EDIT. ' +
    'Public values for circuit A1 (decimal strings); pub_signals order is pinned.',
  pub_signals_order: ['shipment_id', 'c_s', 'head', 'nullifier', 'ts'],
  shipment_id: s(SHIPMENT_ID),
  c_s: s(c_s),
  head: s(head),
  nullifier: s(nullifier),
  ts: s(TS),
  carrier_pk_commit: s(carrier_pk_commit),
  aux: {
    _comment: 'non-public helper values for tests/CLIs',
    pod_msg: s(pod_msg),
    cell_rd: s(cell_rd),
    origin_cell: s(origin_cell),
    dest_region_root: s(dest_region_root),
    lat_q: s(LAT_Q),
    lon_q: s(LON_Q),
    grid_cells: gridCells.map(s),
    leaf_index: LEAF_INDEX,
    dest_depth: DEST_DEPTH,
  },
};

mkdirSync(FIXTURE_DIR, { recursive: true });
writeFileSync(join(FIXTURE_DIR, 'input.json'), JSON.stringify(input, null, 2) + '\n');
writeFileSync(join(FIXTURE_DIR, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(`Written: ${join(FIXTURE_DIR, 'input.json')}`);
console.log(`Written: ${join(FIXTURE_DIR, 'meta.json')}`);
console.log(`  c_s              = ${c_s}`);
console.log(`  head             = ${head}`);
console.log(`  carrier_pk_commit= ${carrier_pk_commit}`);
console.log(`  nullifier        = ${nullifier}`);

// ── Phase 2: emit contracts/aegis-registry/src/test_fixtures.rs ─────────────
const proofPath = join(FIXTURE_DIR, 'proof.json');
const publicPath = join(FIXTURE_DIR, 'public.json');
const vkPath = join(FIXTURE_DIR, 'verification_key.json');
if (!existsSync(proofPath) || !existsSync(publicPath) || !existsSync(vkPath)) {
  console.log('proof.json/public.json/verification_key.json not present yet — ' +
    'skipping test_fixtures.rs (run build.mjs setup + prove, then re-run this script).');
  process.exit(0);
}

const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
const publics = JSON.parse(readFileSync(publicPath, 'utf8'));
const vk = JSON.parse(readFileSync(vkPath, 'utf8'));

// Pin the pub_signals order: [shipment_id, c_s, head, nullifier, ts].
const expectedPublics = [meta.shipment_id, meta.c_s, meta.head, meta.nullifier, meta.ts];
if (JSON.stringify(publics.map((v) => BigInt(v).toString())) !== JSON.stringify(expectedPublics)) {
  throw new Error(
    `public.json order/values do not match the pinned publics.\n` +
    `  got:      ${JSON.stringify(publics)}\n  expected: ${JSON.stringify(expectedPublics)}`,
  );
}
if (Number(vk.nPublic) !== 5 || vk.IC.length !== 6) {
  throw new Error(`vk shape mismatch: nPublic=${vk.nPublic}, |IC|=${vk.IC.length} (want 5 / 6)`);
}

// Byte encoders (rules from prover/src/lib/bn254.ts — v1-verified; the G2 limb
// swap is the classic footgun, imaginary limb c1 FIRST).
function toBE32(dec) {
  let n = BigInt(dec);
  if (n < 0n) throw new Error(`negative: ${dec}`);
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n; }
  if (n !== 0n) throw new Error(`does not fit in 32 bytes: ${dec}`);
  return out;
}
function concat(...arrays) {
  const out = new Uint8Array(arrays.reduce((a, b) => a + b.length, 0));
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}
const encodeG1 = (p) => concat(toBE32(p[0]), toBE32(p[1]));
const encodeG2 = (p) => {
  const [x_c0, x_c1] = p[0];
  const [y_c0, y_c1] = p[1];
  return concat(toBE32(x_c1), toBE32(x_c0), toBE32(y_c1), toBE32(y_c0));
};

function rustBytes(bytes, indent = '    ') {
  const per = 16;
  const lines = [];
  for (let i = 0; i < bytes.length; i += per) {
    lines.push(
      indent + '    ' +
      [...bytes.slice(i, i + per)].map((b) => `0x${b.toString(16).padStart(2, '0')},`).join(' '),
    );
  }
  return `[\n${lines.join('\n')}\n${indent}]`;
}

const piA = encodeG1(proof.pi_a);
const piB = encodeG2(proof.pi_b);
const piC = encodeG1(proof.pi_c);
const vkAlpha = encodeG1(vk.vk_alpha_1);
const vkBeta = encodeG2(vk.vk_beta_2);
const vkGamma = encodeG2(vk.vk_gamma_2);
const vkDelta = encodeG2(vk.vk_delta_2);
const vkIC = vk.IC.map(encodeG1);

const rs = `\
// AUTO-GENERATED by prover/scripts/gen-delivery-fixtures.mjs — DO NOT EDIT.
// Source: circuits/fixtures/delivery/{proof,public,verification_key}.json
// (circuit A1 delivery.circom; honest fixture scenario pinned in that script).
//
// pub_signals order (NORMATIVE): [shipment_id, c_s, head, nullifier, ts]
//   shipment_id = ${meta.shipment_id}
//   c_s         = ${meta.c_s}
//   head        = ${meta.head}
//   nullifier   = ${meta.nullifier}
//   ts          = ${meta.ts}
//   carrier_pk_commit (opened in-circuit, not public) = ${meta.carrier_pk_commit}
//
// Encoding (prover/src/lib/bn254.ts, v1-verified):
//   Bn254G1Affine = BytesN<64>  = BE32(X) || BE32(Y)
//   Bn254G2Affine = BytesN<128> = BE32(x_c1)||BE32(x_c0) || BE32(y_c1)||BE32(y_c0)
//     (imaginary limb FIRST — inverse of the snarkjs JSON order)

use soroban_sdk::{Env, BytesN, U256, Bytes, Vec, vec};
use soroban_sdk::crypto::bn254::{Bn254G1Affine, Bn254G2Affine, BN254_G1_SERIALIZED_SIZE, BN254_G2_SERIALIZED_SIZE};
use crate::groth16::{Proof, VerificationKey};

const PI_A: [u8; BN254_G1_SERIALIZED_SIZE] = ${rustBytes(piA, '')};

const PI_B: [u8; BN254_G2_SERIALIZED_SIZE] = ${rustBytes(piB, '')};

const PI_C: [u8; BN254_G1_SERIALIZED_SIZE] = ${rustBytes(piC, '')};

const VK_ALPHA: [u8; BN254_G1_SERIALIZED_SIZE] = ${rustBytes(vkAlpha, '')};

const VK_BETA: [u8; BN254_G2_SERIALIZED_SIZE] = ${rustBytes(vkBeta, '')};

const VK_GAMMA: [u8; BN254_G2_SERIALIZED_SIZE] = ${rustBytes(vkGamma, '')};

const VK_DELTA: [u8; BN254_G2_SERIALIZED_SIZE] = ${rustBytes(vkDelta, '')};

const VK_IC: [[u8; BN254_G1_SERIALIZED_SIZE]; ${vkIC.length}] = [
${vkIC.map((p) => '    ' + rustBytes(p, '    ') + ',').join('\n')}
];

// Public signals, big-endian 32-byte form (pub_signals order above).
const C_S_BE: [u8; 32] = ${rustBytes(toBE32(meta.c_s), '')};

const CARRIER_PK_COMMIT_BE: [u8; 32] = ${rustBytes(toBE32(meta.carrier_pk_commit), '')};

const HEAD_BE: [u8; 32] = ${rustBytes(toBE32(meta.head), '')};

const NULLIFIER_BE: [u8; 32] = ${rustBytes(toBE32(meta.nullifier), '')};

pub struct DeliveryFixture {
    pub proof: Proof,
    pub shipment_id: u64,        // ${meta.shipment_id}
    pub c_s: U256,
    pub carrier_pk_commit: U256,
    pub head: U256,
    pub nullifier: U256,
    pub ts: u64,                 // ${BigInt(meta.ts).toLocaleString('en-US').replace(/,/g, '_')}
}

fn g1(env: &Env, bytes: &[u8; BN254_G1_SERIALIZED_SIZE]) -> Bn254G1Affine {
    Bn254G1Affine::from_bytes(BytesN::from_array(env, bytes))
}

fn g2(env: &Env, bytes: &[u8; BN254_G2_SERIALIZED_SIZE]) -> Bn254G2Affine {
    Bn254G2Affine::from_bytes(BytesN::from_array(env, bytes))
}

fn u256(env: &Env, be: &[u8; 32]) -> U256 {
    U256::from_be_bytes(env, &Bytes::from_array(env, be))
}

/// Groth16 verification key for circuit A1 (delivery.circom).
/// |IC| = 6 = 5 public signals + 1.
pub fn delivery_vk(env: &Env) -> VerificationKey {
    let mut ic: Vec<Bn254G1Affine> = vec![env];
    for p in VK_IC.iter() {
        ic.push_back(g1(env, p));
    }
    VerificationKey {
        alpha: g1(env, &VK_ALPHA),
        beta: g2(env, &VK_BETA),
        gamma: g2(env, &VK_GAMMA),
        delta: g2(env, &VK_DELTA),
        ic,
    }
}

/// The honest A1 delivery proof + its public signals.
pub fn valid_delivery(env: &Env) -> DeliveryFixture {
    DeliveryFixture {
        proof: Proof {
            a: g1(env, &PI_A),
            b: g2(env, &PI_B),
            c: g1(env, &PI_C),
        },
        shipment_id: ${meta.shipment_id}u64,
        c_s: u256(env, &C_S_BE),
        carrier_pk_commit: u256(env, &CARRIER_PK_COMMIT_BE),
        head: u256(env, &HEAD_BE),
        nullifier: u256(env, &NULLIFIER_BE),
        ts: ${meta.ts}u64,
    }
}
`;

writeFileSync(RUST_OUT, rs);
console.log(`Written: ${RUST_OUT}`);
