#!/usr/bin/env node
/**
 * gen-flight-fixtures.mjs — pinned witness/public fixtures for circuit A2
 * (circuits/flight.circom) plus the Soroban test-fixture emitter.
 *
 * Phase 1 (always): computes the frozen honest drone-flight scenario and writes
 *   circuits/fixtures/flight/input.json      (full witness input)
 *   circuits/fixtures/flight/meta.json       (public values + aux for tests)
 *   circuits/fixtures/flight/corridor.json   (lane 7 cell set + root — consumed
 *                                             later by the authority tool + dashboard)
 * and, when circuits/build/delivery_final.zkey + delivery_js/delivery.wasm
 * exist (they are NEVER regenerated — hard rule 5), also proves the drone PoD
 * (circuit A1 with shipment 2's C_S) and writes
 *   circuits/fixtures/flight/delivery2-{input,proof,public}.json
 *
 * Phase 2 (when circuits/fixtures/flight/{proof,public,verification_key}.json
 * exist — i.e. after `build.mjs setup flight` + `build.mjs prove flight`):
 * overwrites contracts/aegis-registry/src/test_fixtures_flight.rs with the
 * byte-encoded flight proof/VK + drone-delivery proof (encoding rules from
 * prover/src/lib/bn254.ts: G1 = BE32(x)||BE32(y); G2 = BE32(x_c1)||BE32(x_c0)
 * ||BE32(y_c1)||BE32(y_c0) — imaginary limb FIRST, the v1-verified limb order).
 *
 * Scenario provenance (all FROZEN — the registry agent's tests pin on these):
 *   shipment_id = 2;  method = 3 (DRONE);  lane_id = 7
 *   carrier/DRONE seed = bytes 0x01..0x20 (same identity as delivery fixture —
 *     the drone key IS the custody key), recipient seed = bytes 0x21..0x40,
 *     pk_blind = 12345  →  same carrier_pk_commit as the delivery fixture.
 *   shipment_secret = 123123123123123123123123123 (fresh nullifier vs id 1)
 *   C_S opening: sku_hash = Poseidon([888]), qty=1, weight_g=1200,
 *     value_units=1_000_000_000, deadline_ts=1_800_080_000
 *   Geography: dest = delivery fixture's recipient (lat 6.5244 N, lon 3.3792 E,
 *     Lagos) with the IDENTICAL 3×3 r=17 dest-region tree; origin = lat 6.4900,
 *     lon 3.3500 (≈5.1 km away ⇒ ≈17 m/s over the 300 s log — inside VMAX 25
 *     with margin; see §5.5).
 *   Corridor (lane 7): straight origin→dest segment sampled at 64 points,
 *     unique r=15 Morton cells + 8 neighbors each (buffering), deduped, sorted,
 *     depth-12 PAD-filled tree, even index = left.
 *   Waypoints: 16 points evenly interpolated origin→dest;
 *     t[i] = 1_800_000_000 + 20·i  (t_0=1_800_000_000, t_n=1_800_000_300,
 *     dt=20 ≤ GAP_MAX 30); alt_dm[i] = 800 ≤ 1200.
 *   Drone signs d_16 (FlightDigest chain) with the carrier EdDSA key.
 *   Drone PoD (A1 reuse): ts = 1_800_000_400; recipient signs
 *     pod_msg(2, carrier_pk_commit, cell_rd(dest), 1_800_000_400);
 *     nullifier = Poseidon(DOM_NULL, shipment_secret).
 *
 * Run: node prover/scripts/gen-flight-fixtures.mjs   (from anywhere)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildPoseidon, buildEddsa } from 'circomlibjs';

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const FIXTURE_DIR = join(REPO_ROOT, 'circuits/fixtures/flight');
const DELIVERY_FIXTURE_DIR = join(REPO_ROOT, 'circuits/fixtures/delivery');
const BUILD_DIR = join(REPO_ROOT, 'circuits/build');
const RUST_OUT = join(REPO_ROOT, 'contracts/aegis-registry/src/test_fixtures_flight.rs');

// ── Normative constants (DESIGN §5.2–§5.5; parity with circuits/lib/constants.circom) ──
const DOM_SHIP = 1n;
const DOM_ACCEPT = 2n;
const DOM_PODMSG = 5n;
const DOM_NULL = 6n;
const DOM_PKC = 7n;
const DOM_CELL = 9n;
const DOM_FLIGHT = 10n;
const GAP_MAX_SEC = 30n;
const ALT_MAX_DM = 1200n;
const VMAX_U = 20n;
const RC_RES = 15;
const RD_RES = 17;
const CORRIDOR_DEPTH = 12;
const DEST_DEPTH = 6;
const DRONE_MAX_G = 5000n;
const N = 16; // waypoints

// ── Frozen scenario values ───────────────────────────────────────────────────
const SHIPMENT_ID = 2n;
const METHOD = 3n; // DRONE
const LANE_ID = 7;
const PK_BLIND = 12345n;
const QTY = 1n;
const WEIGHT_G = 1200n;
const VALUE_UNITS = 1_000_000_000n;
const DEADLINE_TS = 1_800_080_000n;
const SHIPMENT_SECRET = 123123123123123123123123123n;
const T0 = 1_800_000_000n;
const DT = 20n;
const ALT_DM = 800n;
const POD_TS = 1_800_000_400n;

// Destination — SAME point as the delivery fixture recipient (lat 6.5244 N,
// lon 3.3792 E), exact integer math:
const DEST_LAT_Q = (965244n * 2n ** 24n) / 1800000n;
const DEST_LON_Q = (1833792n * 2n ** 24n) / 3600000n;
// Origin — lat 6.4900 N, lon 3.3500 E (≈5.1 km from dest — flying 16 waypoints
// over 300 s ≈ 17 m/s, inside VMAX 25 m/s with margin):
const ORIG_LAT_Q = (964900n * 2n ** 24n) / 1800000n;
const ORIG_LON_Q = (1833500n * 2n ** 24n) / 3600000n;

// ── Geometry helpers (NORMATIVE Morton mapping — circuits/lib/geocell.circom) ─
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
const carrierSeed = seed(0x01); // the DRONE key IS the custody key
const recipientSeed = seed(0x21);
const [pk_x, pk_y] = eddsa.prv2pub(carrierSeed).map((c) => bjF.toObject(c));
const [recipient_pk_x, recipient_pk_y] = eddsa.prv2pub(recipientSeed).map((c) => bjF.toObject(c));

// ── Waypoints: 16 points evenly interpolated origin→dest ────────────────────
const dLat = Number(DEST_LAT_Q - ORIG_LAT_Q);
const dLon = Number(DEST_LON_Q - ORIG_LON_Q);
const lat_q = [];
const lon_q = [];
const alt_dm = [];
const t = [];
for (let i = 0; i < N; i++) {
  lat_q.push(ORIG_LAT_Q + BigInt(Math.round((dLat * i) / (N - 1))));
  lon_q.push(ORIG_LON_Q + BigInt(Math.round((dLon * i) / (N - 1))));
  alt_dm.push(ALT_DM);
  t.push(T0 + DT * BigInt(i));
}
if (lat_q[N - 1] !== DEST_LAT_Q || lon_q[N - 1] !== DEST_LON_Q) {
  throw new Error('final waypoint must be exactly the destination');
}

// PRE-PROVER checks (§5.5 trap): speed bound + gap + altitude, numerically.
for (let i = 1; i < N; i++) {
  const dt = t[i] - t[i - 1];
  if (t[i] <= t[i - 1]) throw new Error(`non-monotonic t at ${i}`);
  if (dt > GAP_MAX_SEC) throw new Error(`gap ${dt} > GAP_MAX at ${i}`);
  const dlat = lat_q[i] - lat_q[i - 1];
  const dlon = lon_q[i] - lon_q[i - 1];
  const lhs = dlat * dlat + 4n * dlon * dlon;
  const rhs = (VMAX_U * dt) ** 2n;
  if (lhs > rhs) {
    throw new Error(`SPEED BOUND VIOLATED at pair ${i}: ${lhs} > ${rhs}`);
  }
}
for (const a of alt_dm) if (a > ALT_MAX_DM) throw new Error('altitude bust');
if (WEIGHT_G > DRONE_MAX_G) throw new Error('overweight');

// ── Corridor (lane 7): 64-point sampling + 8-neighbor buffering ─────────────
const cellSet = new Set();
const SAMPLES = 64;
for (let k = 0; k < SAMPLES; k++) {
  const sLat = ORIG_LAT_Q + BigInt(Math.round((dLat * k) / (SAMPLES - 1)));
  const sLon = ORIG_LON_Q + BigInt(Math.round((dLon * k) / (SAMPLES - 1)));
  cellSet.add(mortonCell(sLat, sLon, RC_RES).toString());
}
// Buffer: the 8 neighbors of every line cell (±1 in lat/lon top-bit space).
for (const c of [...cellSet]) {
  // invert Morton: odd bits = lat, even bits = lon
  const cell = BigInt(c);
  let latTop = 0n, lonTop = 0n;
  for (let j = 0n; j < BigInt(RC_RES); j++) {
    latTop |= ((cell >> (2n * j + 1n)) & 1n) << j;
    lonTop |= ((cell >> (2n * j)) & 1n) << j;
  }
  for (const da of [-1n, 0n, 1n]) {
    for (const do_ of [-1n, 0n, 1n]) {
      cellSet.add(mortonFromTop(latTop + da, lonTop + do_, RC_RES).toString());
    }
  }
}
const corridorCells = [...cellSet].map(BigInt).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
if (corridorCells.length > 300) {
  throw new Error(`corridor too large: ${corridorCells.length} cells > 300`);
}
if (corridorCells.length > 2 ** CORRIDOR_DEPTH) throw new Error('corridor overflows tree');

// Every waypoint cell MUST be in the corridor set (pre-prover assert).
const corridorIndex = new Map(corridorCells.map((c, i) => [c.toString(), i]));
const waypointCellIdx = [];
for (let i = 0; i < N; i++) {
  const c = mortonCell(lat_q[i], lon_q[i], RC_RES).toString();
  if (!corridorIndex.has(c)) throw new Error(`waypoint ${i} cell ${c} not in corridor`);
  waypointCellIdx.push(corridorIndex.get(c));
}

// ── Fixed-depth PAD-filled trees (even index = left — poseidon-merkle parity) ─
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

const corridorLeaves = corridorCells.map((c) => P(DOM_CELL, c));
while (corridorLeaves.length < 2 ** CORRIDOR_DEPTH) corridorLeaves.push(PAD);
const corridorLevels = buildLevels(corridorLeaves);
const corridor_root = corridorLevels[CORRIDOR_DEPTH][0];

const corridor_path = [];
const corridor_index = [];
for (let i = 0; i < N; i++) {
  const { pathElements, pathIndices } = genPath(corridorLevels, waypointCellIdx[i]);
  corridor_path.push(pathElements);
  corridor_index.push(pathIndices);
}

// ── Destination region: rebuild the delivery fixture's 3×3 r=17 grid tree ───
// (IDENTICAL builder — dest_region_root must match the delivery fixture's).
const destLatTop = topBits(DEST_LAT_Q, RD_RES);
const destLonTop = topBits(DEST_LON_Q, RD_RES);
const gridCells = [];
for (const dlat of [-1n, 0n, 1n]) {
  for (const dlon of [-1n, 0n, 1n]) {
    gridCells.push(mortonFromTop(destLatTop + dlat, destLonTop + dlon, RD_RES));
  }
}
const LEAF_INDEX = 4; // center = the destination's own cell
const cell_rd = gridCells[LEAF_INDEX];
if (cell_rd !== mortonCell(DEST_LAT_Q, DEST_LON_Q, RD_RES)) throw new Error('grid center mismatch');
if (cell_rd !== mortonCell(lat_q[N - 1], lon_q[N - 1], RD_RES)) {
  throw new Error('final waypoint RD cell is not the dest cell');
}

const destLeaves = gridCells.map((c) => P(DOM_CELL, c));
while (destLeaves.length < 2 ** DEST_DEPTH) destLeaves.push(PAD);
const destLevels = buildLevels(destLeaves);
const dest_region_root = destLevels[DEST_DEPTH][0];
const { pathElements: dest_path, pathIndices: dest_index } = genPath(destLevels, LEAF_INDEX);

// Cross-check against the committed delivery fixture (same dest, same tree).
{
  const deliveryMeta = JSON.parse(readFileSync(join(DELIVERY_FIXTURE_DIR, 'meta.json'), 'utf8'));
  if (dest_region_root.toString() !== deliveryMeta.aux.dest_region_root) {
    throw new Error('dest_region_root does not match the delivery fixture rebuild');
  }
  if (cell_rd.toString() !== deliveryMeta.aux.cell_rd) {
    throw new Error('cell_rd does not match the delivery fixture');
  }
}

// ── C_S, head, nullifier ─────────────────────────────────────────────────────
const sku_hash = P(888n);
const origin_cell = mortonCell(ORIG_LAT_Q, ORIG_LON_Q, RC_RES);
if (origin_cell !== mortonCell(lat_q[0], lon_q[0], RC_RES)) {
  throw new Error('waypoint 0 cell != origin_cell');
}
const c_s = P(
  DOM_SHIP, sku_hash, QTY, WEIGHT_G, VALUE_UNITS, origin_cell, dest_region_root,
  recipient_pk_x, recipient_pk_y, METHOD, DEADLINE_TS, SHIPMENT_SECRET,
);
const carrier_pk_commit = P(DOM_PKC, pk_x, pk_y, PK_BLIND);
const EXPECTED_CPC = 15455931307768948041595817576412392366190915015111339244245604316125360041285n;
if (carrier_pk_commit !== EXPECTED_CPC) {
  throw new Error('carrier_pk_commit drifted from the pinned delivery-fixture value');
}
const head = h2(h2(DOM_ACCEPT, SHIPMENT_ID), carrier_pk_commit);
const nullifier = P(DOM_NULL, SHIPMENT_SECRET);

// ── Flight digest chain + drone signature (digest-then-sign, DESIGN §8.3) ───
let d = P(DOM_FLIGHT, SHIPMENT_ID); // d_0 — binds the log to shipment 2 (T7)
for (let i = 0; i < N; i++) {
  d = P(d, lat_q[i], lon_q[i], alt_dm[i], t[i]);
}
const d16 = d;
const flightSig = eddsa.signPoseidon(carrierSeed, bjF.e(d16));
if (!eddsa.verifyPoseidon(bjF.e(d16), flightSig, eddsa.prv2pub(carrierSeed))) {
  throw new Error('self-check failed: drone flight signature does not verify');
}

// ── Phase 1: emit input.json + meta.json + corridor.json ────────────────────
const s = (v) => v.toString();
const T_N = t[N - 1];
const input = {
  shipment_id: s(SHIPMENT_ID),
  c_s: s(c_s),
  head: s(head),
  corridor_root: s(corridor_root),
  t_0: s(T0),
  t_n: s(T_N),
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
  sig_R8x: s(bjF.toObject(flightSig.R8[0])),
  sig_R8y: s(bjF.toObject(flightSig.R8[1])),
  sig_S: s(flightSig.S),
  lat_q: lat_q.map(s),
  lon_q: lon_q.map(s),
  alt_dm: alt_dm.map(s),
  t: t.map(s),
  corridor_path: corridor_path.map((p) => p.map(s)),
  corridor_index: corridor_index.map((p) => p.map(s)),
  dest_path: dest_path.map(s),
  dest_index: dest_index.map(s),
};

const meta = {
  _comment:
    'AUTO-GENERATED by prover/scripts/gen-flight-fixtures.mjs — DO NOT EDIT. ' +
    'Public values for circuit A2 (decimal strings); pub_signals order is pinned.',
  pub_signals_order: ['shipment_id', 'c_s', 'head', 'corridor_root', 't_0', 't_n'],
  shipment_id: s(SHIPMENT_ID),
  c_s: s(c_s),
  head: s(head),
  corridor_root: s(corridor_root),
  t_0: s(T0),
  t_n: s(T_N),
  carrier_pk_commit: s(carrier_pk_commit),
  lane_id: LANE_ID,
  aux: {
    _comment: 'non-public helper values for tests/CLIs',
    d16: s(d16),
    origin_cell: s(origin_cell),
    dest_region_root: s(dest_region_root),
    cell_rd: s(cell_rd),
    nullifier: s(nullifier),
    pod_ts: s(POD_TS),
    orig_lat_q: s(ORIG_LAT_Q),
    orig_lon_q: s(ORIG_LON_Q),
    dest_lat_q: s(DEST_LAT_Q),
    dest_lon_q: s(DEST_LON_Q),
    alt_dm: s(ALT_DM),
    waypoint_cell_index: waypointCellIdx,
    corridor_cell_count: corridorCells.length,
    grid_cells: gridCells.map(s),
    leaf_index: LEAF_INDEX,
  },
};

const corridorJson = {
  _comment:
    'AUTO-GENERATED by prover/scripts/gen-flight-fixtures.mjs — DO NOT EDIT. ' +
    'Lane 7 corridor: r=15 Morton cells (decimal strings, sorted) of the buffered ' +
    'origin→dest segment; depth-12 PAD-filled Poseidon tree, even index = left.',
  lane_id: LANE_ID,
  cells: corridorCells.map(s),
  root: s(corridor_root),
};

mkdirSync(FIXTURE_DIR, { recursive: true });
writeFileSync(join(FIXTURE_DIR, 'input.json'), JSON.stringify(input, null, 2) + '\n');
writeFileSync(join(FIXTURE_DIR, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
writeFileSync(join(FIXTURE_DIR, 'corridor.json'), JSON.stringify(corridorJson, null, 2) + '\n');
console.log(`Written: ${join(FIXTURE_DIR, 'input.json')}`);
console.log(`Written: ${join(FIXTURE_DIR, 'meta.json')}`);
console.log(`Written: ${join(FIXTURE_DIR, 'corridor.json')} (${corridorCells.length} cells)`);
console.log(`  c_s               = ${c_s}`);
console.log(`  head              = ${head}`);
console.log(`  corridor_root     = ${corridor_root}`);
console.log(`  carrier_pk_commit = ${carrier_pk_commit}`);
console.log(`  nullifier (id 2)  = ${nullifier}`);
console.log(`  t_0 = ${T0}, t_n = ${T_N}, d16 = ${d16}`);

// ── Drone PoD: A1 delivery proof for shipment 2 (REUSES the frozen zkey) ────
const deliveryWasm = join(BUILD_DIR, 'delivery_js', 'delivery.wasm');
const deliveryZkey = join(BUILD_DIR, 'delivery_final.zkey');
const pod_msg = P(DOM_PODMSG, SHIPMENT_ID, carrier_pk_commit, cell_rd, POD_TS);
const podSig = eddsa.signPoseidon(recipientSeed, bjF.e(pod_msg));
if (!eddsa.verifyPoseidon(bjF.e(pod_msg), podSig, eddsa.prv2pub(recipientSeed))) {
  throw new Error('self-check failed: recipient PoD signature does not verify');
}
// Field names are delivery.circom's (dest_path_index, singular lat_q/lon_q).
const delivery2Input = {
  shipment_id: s(SHIPMENT_ID),
  c_s: s(c_s),
  head: s(head),
  nullifier: s(nullifier),
  ts: s(POD_TS),
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
  sig_R8x: s(bjF.toObject(podSig.R8[0])),
  sig_R8y: s(bjF.toObject(podSig.R8[1])),
  sig_S: s(podSig.S),
  lat_q: s(DEST_LAT_Q),
  lon_q: s(DEST_LON_Q),
  dest_path: dest_path.map(s),
  dest_path_index: dest_index.map(s),
};
writeFileSync(join(FIXTURE_DIR, 'delivery2-input.json'), JSON.stringify(delivery2Input, null, 2) + '\n');
console.log(`Written: ${join(FIXTURE_DIR, 'delivery2-input.json')}`);

let delivery2Proof = null;
let delivery2Publics = null;
if (existsSync(deliveryWasm) && existsSync(deliveryZkey)) {
  const snarkjs = require('snarkjs');
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    delivery2Input, deliveryWasm, deliveryZkey,
  );
  const deliveryVk = JSON.parse(readFileSync(join(DELIVERY_FIXTURE_DIR, 'verification_key.json'), 'utf8'));
  const ok = await snarkjs.groth16.verify(deliveryVk, publicSignals, proof);
  if (!ok) throw new Error('delivery2 (drone PoD) proof FAILED to verify');
  console.log('snarkjs verify (delivery2 drone PoD vs delivery VK): OK');
  const expected = [s(SHIPMENT_ID), s(c_s), s(head), s(nullifier), s(POD_TS)];
  if (JSON.stringify(publicSignals.map((v) => BigInt(v).toString())) !== JSON.stringify(expected)) {
    throw new Error('delivery2 publics mismatch the pinned scenario');
  }
  writeFileSync(join(FIXTURE_DIR, 'delivery2-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  writeFileSync(join(FIXTURE_DIR, 'delivery2-public.json'), JSON.stringify(publicSignals, null, 2) + '\n');
  console.log(`Written: ${join(FIXTURE_DIR, 'delivery2-proof.json')} + delivery2-public.json`);
  delivery2Proof = proof;
  delivery2Publics = publicSignals;
  // fullProve leaves worker threads alive — allow phase 2 to run, exit at end.
} else {
  console.log('delivery zkey/wasm not present — skipping the drone-PoD (delivery2) proof.');
}

// ── Phase 2: emit contracts/aegis-registry/src/test_fixtures_flight.rs ──────
const proofPath = join(FIXTURE_DIR, 'proof.json');
const publicPath = join(FIXTURE_DIR, 'public.json');
const vkPath = join(FIXTURE_DIR, 'verification_key.json');
const d2ProofPath = join(FIXTURE_DIR, 'delivery2-proof.json');
if (!existsSync(proofPath) || !existsSync(publicPath) || !existsSync(vkPath) || !existsSync(d2ProofPath)) {
  console.log('flight proof/public/verification_key (or delivery2-proof) not present yet — ' +
    'skipping test_fixtures_flight.rs (run build.mjs setup flight + prove flight, then re-run).');
  process.exit(0);
}

const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
const publics = JSON.parse(readFileSync(publicPath, 'utf8'));
const vk = JSON.parse(readFileSync(vkPath, 'utf8'));
if (!delivery2Proof) {
  delivery2Proof = JSON.parse(readFileSync(d2ProofPath, 'utf8'));
  delivery2Publics = JSON.parse(readFileSync(join(FIXTURE_DIR, 'delivery2-public.json'), 'utf8'));
}

// Pin the pub_signals order: [shipment_id, c_s, head, corridor_root, t_0, t_n].
const expectedPublics = [meta.shipment_id, meta.c_s, meta.head, meta.corridor_root, meta.t_0, meta.t_n];
if (JSON.stringify(publics.map((v) => BigInt(v).toString())) !== JSON.stringify(expectedPublics)) {
  throw new Error(
    `flight public.json order/values do not match the pinned publics.\n` +
    `  got:      ${JSON.stringify(publics)}\n  expected: ${JSON.stringify(expectedPublics)}`,
  );
}
if (Number(vk.nPublic) !== 6 || vk.IC.length !== 7) {
  throw new Error(`flight vk shape mismatch: nPublic=${vk.nPublic}, |IC|=${vk.IC.length} (want 6 / 7)`);
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
const d2A = encodeG1(delivery2Proof.pi_a);
const d2B = encodeG2(delivery2Proof.pi_b);
const d2C = encodeG1(delivery2Proof.pi_c);
const vkAlpha = encodeG1(vk.vk_alpha_1);
const vkBeta = encodeG2(vk.vk_beta_2);
const vkGamma = encodeG2(vk.vk_gamma_2);
const vkDelta = encodeG2(vk.vk_delta_2);
const vkIC = vk.IC.map(encodeG1);

const rs = `\
// AUTO-GENERATED by prover/scripts/gen-flight-fixtures.mjs — DO NOT EDIT.
// Source: circuits/fixtures/flight/{proof,public,verification_key}.json
// (circuit A2 flight.circom, N=16 waypoints) and
// circuits/fixtures/flight/delivery2-{proof,public}.json (drone PoD — circuit
// A1 reusing the FROZEN delivery zkey with shipment 2's C_S).
//
// flight pub_signals order (NORMATIVE):
//   [shipment_id, c_s, head, corridor_root, t_0, t_n]
//   shipment_id   = ${meta.shipment_id}
//   c_s           = ${meta.c_s}
//   head          = ${meta.head}
//   corridor_root = ${meta.corridor_root}   (lane_id = ${LANE_ID})
//   t_0           = ${meta.t_0}
//   t_n           = ${meta.t_n}
//   carrier_pk_commit (opened in-circuit, not public) = ${meta.carrier_pk_commit}
//
// drone-delivery (A1) publics: [shipment_id=2, c_s, head, nullifier, ts]
//   nullifier = ${nullifier}
//   ts        = ${POD_TS}
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

const D2_PI_A: [u8; BN254_G1_SERIALIZED_SIZE] = ${rustBytes(d2A, '')};

const D2_PI_B: [u8; BN254_G2_SERIALIZED_SIZE] = ${rustBytes(d2B, '')};

const D2_PI_C: [u8; BN254_G1_SERIALIZED_SIZE] = ${rustBytes(d2C, '')};

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

const CORRIDOR_ROOT_BE: [u8; 32] = ${rustBytes(toBE32(meta.corridor_root), '')};

const NULLIFIER_BE: [u8; 32] = ${rustBytes(toBE32(nullifier), '')};

pub struct FlightFixture {
    pub proof: Proof,
    pub shipment_id: u64,      // ${meta.shipment_id}
    pub c_s: U256,
    pub carrier_pk_commit: U256,
    pub head: U256,
    pub corridor_root: U256,
    pub t_0: u64,              // ${meta.t_0.replace(/\B(?=(\d{3})+(?!\d))/g, '_')}
    pub t_n: u64,              // ${meta.t_n.replace(/\B(?=(\d{3})+(?!\d))/g, '_')}
}

pub struct DroneDelivery {
    pub proof: Proof,
    pub nullifier: U256,
    pub ts: u64,               // ${POD_TS.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '_')}
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

/// Groth16 verification key for circuit A2 (flight.circom).
/// |IC| = 7 = 6 public signals + 1.
pub fn flight_vk(env: &Env) -> VerificationKey {
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

/// The honest A2 flight proof + its public signals (lane_id = ${LANE_ID}).
pub fn valid_flight(env: &Env) -> FlightFixture {
    FlightFixture {
        proof: Proof {
            a: g1(env, &PI_A),
            b: g2(env, &PI_B),
            c: g1(env, &PI_C),
        },
        shipment_id: ${meta.shipment_id}u64,
        c_s: u256(env, &C_S_BE),
        carrier_pk_commit: u256(env, &CARRIER_PK_COMMIT_BE),
        head: u256(env, &HEAD_BE),
        corridor_root: u256(env, &CORRIDOR_ROOT_BE),
        t_0: ${meta.t_0}u64,
        t_n: ${meta.t_n}u64,
    }
}

/// The drone PoD: an honest A1 delivery proof for shipment 2 (verifies against
/// \`test_fixtures::delivery_vk\` — the FROZEN delivery VK; publics
/// [2, c_s, head, nullifier, ts] with c_s/head as in \`valid_flight\`).
pub fn drone_delivery(env: &Env) -> DroneDelivery {
    DroneDelivery {
        proof: Proof {
            a: g1(env, &D2_PI_A),
            b: g2(env, &D2_PI_B),
            c: g1(env, &D2_PI_C),
        },
        nullifier: u256(env, &NULLIFIER_BE),
        ts: ${POD_TS}u64,
    }
}
`;

writeFileSync(RUST_OUT, rs);
console.log(`Written: ${RUST_OUT}`);
process.exit(0);
