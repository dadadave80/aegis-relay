// flight.test.mjs — circuit A2 (flight.circom) positive + negative suite
// (DESIGN §9 A2 negative-test list; threat rows T5–T7/T13–T15).
//
// Every negative test mutates the honest fixture input and asserts that
// witness generation / constraint checking FAILS. Where a mutation changes
// the flight-log digest, the log is RE-SIGNED with the drone (carrier) key so
// each test isolates the constraint it targets — except splice/foreign-key,
// whose entire point is a signature that must NOT verify.
//
// Run from repo root: node circuits/test/flight.test.mjs
// Exits nonzero on any failure.

import { readFileSync, copyFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { buildPoseidon, buildEddsa } from 'circomlibjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const fixtureDir = path.join(repoRoot, 'circuits', 'fixtures', 'flight');
const deliveryFixtureDir = path.join(repoRoot, 'circuits', 'fixtures', 'delivery');
const buildDir = path.join(repoRoot, 'circuits', 'build');
const require = createRequire(import.meta.url);
const snarkjs = require('snarkjs');

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`PASS ${name}`);
  else { failures++; console.log(`FAIL ${name}${extra ? ' -- ' + extra : ''}`); }
}

// ── compile with --inspect (T15 inspect_gate) ────────────────────────────────
// NOTE: flight is compiled with --O2 (full linear simplification) — at the
// default --O1 the 16×depth-12 corridor Merkle layer leaves ~70k linear
// constraints in the r1cs (145,329 total > pot18's 131,072 budget under hard
// rule 5); --O2 eliminates them (70,565 constraints, equisatisfiable system).
// The committed zkey/VK were generated from this exact --O2 r1cs.
//
// KNOWN-BENIGN allowlist: all warnings live INSIDE circomlib templates, never
// ours:
//   - CompConstant(...) / EscalarMulAny(254) / EscalarMulFix(253, ...): pulled
//     in by EdDSAPoseidonVerifier — same three as delivery.test.mjs.
//   - LessThan(n) (comparators.circom, via LtChecked/LeqChecked): uses only
//     n2b.out[n] by construction; the lower bits are fully constrained inside
//     Num2Bits.
// Fixing them would mean patching circomlib in node_modules — out of scope.
// Everything in circuits/flight.circom + circuits/lib/ is --inspect clean.
const ALLOWED_WARNINGS = [
  'In template "CompConstant(',
  'In template "EscalarMulAny(254)"',
  'In template "EscalarMulFix(253,',
  'In template "LessThan(',
];
{
  const res = spawnSync('circom', [
    path.join('circuits', 'flight.circom'),
    '--r1cs', '--wasm', '--sym', '--O2', '--inspect',
    '-l', path.join('circuits', 'node_modules'),
    '-o', path.join('circuits', 'build'),
  ], { cwd: repoRoot, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`circom failed:\n${res.stdout}\n${res.stderr}`);
  const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  const warnings = out.split('\n').filter((l) => l.includes('warning'));
  const unexpected = warnings.filter((w) => !ALLOWED_WARNINGS.some((a) => w.includes(a)));
  check('inspect_gate(flight): --inspect clean outside circomlib internals',
    unexpected.length === 0, unexpected.join(' | '));
}

// ── shared crypto helpers ────────────────────────────────────────────────────
const poseidon = await buildPoseidon();
const F = poseidon.F;
const P = (...inputs) => F.toObject(poseidon(inputs.map(BigInt)));
const h2 = (a, b) => P(a, b);
const PAD = h2(0n, 0n);

const eddsa = await buildEddsa();
const bjF = eddsa.babyJub.F;
const seed = (firstByte) => Buffer.from(Array.from({ length: 32 }, (_, i) => firstByte + i));
const CARRIER_SEED = seed(0x01);   // parity identity — carrier == drone key
const RECIPIENT_SEED = seed(0x21); // parity identity — recipient

const DOM_CELL = 9n;
const DOM_FLIGHT = 10n;
const N = 16;
const CORRIDOR_DEPTH = 12;
const RC_RES = 15n;

function sign(prv, m) {
  const sig = eddsa.signPoseidon(prv, bjF.e(m));
  return {
    sig_R8x: bjF.toObject(sig.R8[0]).toString(),
    sig_R8y: bjF.toObject(sig.R8[1]).toString(),
    sig_S: sig.S.toString(),
  };
}

// d_16 over a (possibly mutated) log, then drone re-signature. Each mutation
// that touches the log calls this so the ONLY failing constraint is the one
// the test targets, never a stale signature (delivery.test.mjs pattern).
function resign(inp, signer = CARRIER_SEED) {
  let d = P(DOM_FLIGHT, BigInt(inp.shipment_id));
  for (let i = 0; i < N; i++) {
    d = P(d, BigInt(inp.lat_q[i]), BigInt(inp.lon_q[i]), BigInt(inp.alt_dm[i]), BigInt(inp.t[i]));
  }
  return { ...inp, ...sign(signer, d) };
}

// Normative Morton mapping (geocell.circom) at r=15.
function rcCell(latQ, lonQ) {
  let cell = 0n;
  for (let j = 0n; j < RC_RES; j++) {
    cell |= (((latQ >> (24n - RC_RES + j)) & 1n) << (2n * j + 1n));
    cell |= (((lonQ >> (24n - RC_RES + j)) & 1n) << (2n * j));
  }
  return cell;
}

// ── fixtures ─────────────────────────────────────────────────────────────────
const input = JSON.parse(readFileSync(path.join(fixtureDir, 'input.json'), 'utf8'));
const meta = JSON.parse(readFileSync(path.join(fixtureDir, 'meta.json'), 'utf8'));
const corridor = JSON.parse(readFileSync(path.join(fixtureDir, 'corridor.json'), 'utf8'));

// Rebuild the committed corridor tree (35 real leaves, PAD to 4096, even
// index = left) — needed for probe paths and the teleport re-path.
const corridorLeaves = corridor.cells.map((c) => P(DOM_CELL, BigInt(c)));
while (corridorLeaves.length < 2 ** CORRIDOR_DEPTH) corridorLeaves.push(PAD);
const levels = [corridorLeaves];
{
  let cur = corridorLeaves;
  while (cur.length > 1) {
    const next = [];
    for (let i = 0; i < cur.length; i += 2) next.push(h2(cur[i], cur[i + 1]));
    levels.push(next);
    cur = next;
  }
}
check('rebuilt corridor tree matches committed corridor_root',
  levels[CORRIDOR_DEPTH][0].toString() === meta.corridor_root,
  `root ${levels[CORRIDOR_DEPTH][0]} != ${meta.corridor_root}`);

function corridorPath(index) {
  const pathElements = [];
  const pathIndices = [];
  let idx = index;
  for (let lvl = 0; lvl < CORRIDOR_DEPTH; lvl++) {
    pathElements.push(levels[lvl][(idx & 1) === 0 ? idx + 1 : idx - 1].toString());
    pathIndices.push((idx & 1).toString());
    idx >>= 1;
  }
  return { pathElements, pathIndices };
}

async function loadWitnessCalculator() {
  const dir = path.join(buildDir, 'flight_js');
  // circom emits CommonJS; circuits/package.json is "type":"module" — copy to
  // .cjs (build dir is gitignored) so node loads it as CommonJS.
  const cjs = path.join(dir, 'witness_calculator.cjs');
  copyFileSync(path.join(dir, 'witness_calculator.js'), cjs);
  const builder = require(cjs);
  return builder(readFileSync(path.join(dir, 'flight.wasm')));
}
const wc = await loadWitnessCalculator();

async function tryWitness(inp) {
  try {
    await wc.calculateWitness(inp, true); // sanityCheck=true → throws on any violated constraint
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e.message ?? e) };
  }
}

// ── positive: honest witness satisfies ───────────────────────────────────────
{
  const res = await tryWitness(input);
  check('honest witness satisfies all constraints', res.ok, res.err ?? '');
}

// ── negative 1 (stray): waypoint 8 moved 3 RC-cells off-corridor ─────────────
// +3 cells in lon (east, away from the buffered lane). The drone honestly
// re-signs the strayed log; the input keeps the honest wp8 corridor path (a
// path for the strayed cell does not exist in the tree) → Merkle root
// mismatch. (The stray also busts the speed bound — off-corridor teleports
// inherently do — but membership fails regardless.)
{
  const lonQ = BigInt(input.lon_q[8]) + 3n * 2n ** 9n;
  const strayCell = rcCell(BigInt(input.lat_q[8]), lonQ);
  check('stray: mutated cell is NOT in the corridor set (test is well-formed)',
    !corridor.cells.includes(strayCell.toString()));
  const bad = resign({ ...input, lon_q: input.lon_q.map((v, i) => (i === 8 ? lonQ.toString() : v)) });
  const res = await tryWitness(bad);
  check('stray: waypoint 8 moved 3 cells off-corridor rejected', !res.ok,
    'witness unexpectedly satisfied');
}

// ── negative 2 (teleport): 900-unit lat jump with dt = 20 ────────────────────
// 900² = 810_000 > (VMAX_U·dt)² = 160_000. The jumped waypoint deliberately
// STAYS inside the corridor (its true cell gets a correct membership path),
// and the log is re-signed — so the ONLY failing constraint is §5.5.
{
  const latQ = BigInt(input.lat_q[8]) + 900n;
  const newCell = rcCell(latQ, BigInt(input.lon_q[8]));
  const cellIdx = corridor.cells.indexOf(newCell.toString());
  check('teleport: jumped cell IS in the corridor (test isolates the speed bound)',
    cellIdx !== -1);
  const { pathElements, pathIndices } = corridorPath(cellIdx);
  const bad = resign({
    ...input,
    lat_q: input.lat_q.map((v, i) => (i === 8 ? latQ.toString() : v)),
    corridor_path: input.corridor_path.map((p, i) => (i === 8 ? pathElements : p)),
    corridor_index: input.corridor_index.map((p, i) => (i === 8 ? pathIndices : p)),
  });
  const res = await tryWitness(bad);
  check('teleport: 900-unit lat jump (dt=20) rejected by speed bound', !res.ok,
    'witness unexpectedly satisfied');
}

// ── negative 3 (gap): t[8] = t[7] + 45 > GAP_MAX = 30 ────────────────────────
// Tail shifted so every later gap stays 20 s and t_n matches t[15] — the ONLY
// failing constraint is the 45 s gap. (Speed at dt=45 passes: the honest
// leg is far under VMAX·45.)
{
  const tNew = input.t.map((v, i) =>
    (i < 8 ? v : (BigInt(input.t[7]) + 45n + 20n * BigInt(i - 8)).toString()));
  const bad = resign({ ...input, t: tNew, t_n: tNew[N - 1] });
  const res = await tryWitness(bad);
  check('gap: t[8] = t[7] + 45 rejected (GAP_MAX = 30)', !res.ok,
    'witness unexpectedly satisfied');
}

// ── negative 4 (non-monotonic): t[8] < t[7] ──────────────────────────────────
// Tail re-based on the rolled-back t[8] so later pairs stay clean; t_n
// matches; re-signed. Fails strict monotonicity (and the 8-bit dt pin — the
// wrapped negative difference is the same T14 trap).
{
  const tNew = input.t.map((v, i) =>
    (i < 8 ? v : (BigInt(input.t[7]) - 5n + 20n * BigInt(i - 8)).toString()));
  const bad = resign({ ...input, t: tNew, t_n: tNew[N - 1] });
  const res = await tryWitness(bad);
  check('non-monotonic: t[8] < t[7] rejected', !res.ok, 'witness unexpectedly satisfied');
}

// ── negative 5 (T7 splice): honest shipment-2 log replayed as shipment 3 ─────
// shipment_id input flipped to 3, ORIGINAL signature kept (the attacker does
// not hold the drone key): d_0 = P(DOM_FLIGHT, 3) re-derives a different d_16,
// so the signature over shipment 2's digest dies — and the head/C_S openings
// for id 3 break too. The log cannot be spliced across shipments.
{
  const bad = { ...input, shipment_id: '3' };
  const res = await tryWitness(bad);
  check('T7 splice: shipment-2 log replayed under shipment_id=3 rejected', !res.ok,
    'witness unexpectedly satisfied');
}

// ── negative 6 (foreign-key): digest signed by the recipient key ─────────────
// The head opening keeps the carrier (drone) pk in the witness; the EdDSA
// verify against that pk must reject a signature by any other key.
{
  const bad = resign(input, RECIPIENT_SEED);
  const res = await tryWitness(bad);
  check('foreign-key: d16 signed by non-custodian key rejected', !res.ok,
    'witness unexpectedly satisfied');
}

// ── negative 7 (heavy): weight_g = 6000 > DRONE_MAX_G = 5000 ─────────────────
// weight_g lives in C_S, not the flight log — the digest/signature stay
// honest. c_s (public) is recomputed over the heavy opening so the C_S
// equation holds and the ONLY failing constraint is the weight bound.
{
  const heavy = 6000n;
  const c_s = P(1n, BigInt(input.sku_hash), BigInt(input.qty), heavy,
    BigInt(input.value_units), BigInt(input.origin_cell), BigInt(input.dest_region_root),
    BigInt(input.recipient_pk_x), BigInt(input.recipient_pk_y), BigInt(input.method),
    BigInt(input.deadline_ts), BigInt(input.shipment_secret));
  const bad = { ...input, weight_g: heavy.toString(), c_s: c_s.toString() };
  const res = await tryWitness(bad);
  check('heavy: weight_g = 6000 rejected (DRONE_MAX_G = 5000)', !res.ok,
    'witness unexpectedly satisfied');
}

// ── negative 8 (altitude): alt_dm[8] = 1500 > ALT_MAX_DM = 1200 ──────────────
{
  const bad = resign({
    ...input,
    alt_dm: input.alt_dm.map((v, i) => (i === 8 ? '1500' : v)),
  });
  const res = await tryWitness(bad);
  check('altitude: alt_dm[8] = 1500 rejected (ALT_MAX = 1200)', !res.ok,
    'witness unexpectedly satisfied');
}

// ── negative 9 (T13 pad_membership): corridor path pointing at a PAD slot ────
// The probe path is the PERFECTLY CONSISTENT authentication path of PAD slot
// 100 (leaf = PAD reproduces corridor_root exactly). In A2 the leaf is derived
// in-circuit as Poseidon(DOM_CELL, cell) and can never equal PAD =
// Poseidon(0,0), so the probe must fail; direct leaf-as-witness PAD injection
// against MerkleInclusion's leaf != PAD() constraint is covered at gadget
// level by test/gadgets/pad_membership.test.mjs.
{
  const PAD_SLOT = 100; // any slot past the 35 real leaves
  const { pathElements, pathIndices } = corridorPath(PAD_SLOT);
  // Sanity: the probe path IS consistent for leaf = PAD.
  let node = PAD;
  let idx = PAD_SLOT;
  for (const sib of pathElements) {
    node = (idx & 1) === 0 ? h2(node, BigInt(sib)) : h2(BigInt(sib), node);
    idx >>= 1;
  }
  check('T13 probe path is consistent for leaf = PAD (probe is well-formed)',
    node.toString() === meta.corridor_root);

  const bad = {
    ...input,
    corridor_path: input.corridor_path.map((p, i) => (i === 8 ? pathElements : p)),
    corridor_index: input.corridor_index.map((p, i) => (i === 8 ? pathIndices : p)),
  };
  const res = await tryWitness(bad);
  check('T13: PAD-slot corridor membership attempt rejected', !res.ok,
    'witness unexpectedly satisfied');
}

// ── committed proof fixture verifies + pub_signals order pinned ─────────────
{
  const vk = JSON.parse(readFileSync(path.join(fixtureDir, 'verification_key.json'), 'utf8'));
  const proof = JSON.parse(readFileSync(path.join(fixtureDir, 'proof.json'), 'utf8'));
  const publics = JSON.parse(readFileSync(path.join(fixtureDir, 'public.json'), 'utf8'));

  const expected = [meta.shipment_id, meta.c_s, meta.head, meta.corridor_root, meta.t_0, meta.t_n];
  check('public.json order = [shipment_id, c_s, head, corridor_root, t_0, t_n]',
    JSON.stringify(publics.map((v) => BigInt(v).toString())) === JSON.stringify(expected));

  const ok = await snarkjs.groth16.verify(vk, publics, proof);
  check('snarkjs groth16 verify of committed flight proof fixture OK', ok === true);
}

// ── committed drone-PoD (delivery2) fixture verifies against the DELIVERY vk ─
{
  const vk = JSON.parse(readFileSync(path.join(deliveryFixtureDir, 'verification_key.json'), 'utf8'));
  const proof = JSON.parse(readFileSync(path.join(fixtureDir, 'delivery2-proof.json'), 'utf8'));
  const publics = JSON.parse(readFileSync(path.join(fixtureDir, 'delivery2-public.json'), 'utf8'));

  const expected = [meta.shipment_id, meta.c_s, meta.head, meta.aux.nullifier, meta.aux.pod_ts];
  check('delivery2 publics = [shipment_id=2, c_s, head, nullifier, ts]',
    JSON.stringify(publics.map((v) => BigInt(v).toString())) === JSON.stringify(expected));

  const ok = await snarkjs.groth16.verify(vk, publics, proof);
  check('snarkjs groth16 verify of committed drone-PoD (delivery2) fixture OK', ok === true);
}

// ── fresh end-to-end prove + verify (only when the local zkey exists) ────────
{
  const zkey = path.join(buildDir, 'flight_final.zkey');
  if (existsSync(zkey)) {
    const vk = JSON.parse(readFileSync(path.join(fixtureDir, 'verification_key.json'), 'utf8'));
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input, path.join(buildDir, 'flight_js', 'flight.wasm'), zkey);
    const ok = await snarkjs.groth16.verify(vk, publicSignals, proof);
    check('fresh groth16 prove + verify from honest witness OK', ok === true);
  } else {
    console.log('SKIP fresh prove (circuits/build/flight_final.zkey not present — run build.mjs setup)');
  }
}

process.exit(failures ? 1 : 0);
