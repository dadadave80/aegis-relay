// delivery.test.mjs — circuit A1 (delivery.circom) positive + negative suite
// (DESIGN §9 A1 negative-test list; threat rows T1/T8/T13/T14/T15).
//
// Every negative test mutates the honest fixture input and asserts that
// witness generation / constraint checking FAILS. Where a mutation would
// trivially break the EdDSA signature as a side effect, the PoD message is
// RE-SIGNED with the correct recipient key so the test isolates the one
// constraint it targets.
//
// Run from repo root: node circuits/test/delivery.test.mjs
// Exits nonzero on any failure.

import { readFileSync, copyFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { buildPoseidon, buildEddsa } from 'circomlibjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const fixtureDir = path.join(repoRoot, 'circuits', 'fixtures', 'delivery');
const buildDir = path.join(repoRoot, 'circuits', 'build');
const require = createRequire(import.meta.url);
const snarkjs = require('snarkjs');

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`PASS ${name}`);
  else { failures++; console.log(`FAIL ${name}${extra ? ' -- ' + extra : ''}`); }
}

// ── compile with --inspect (T15 inspect_gate) ────────────────────────────────
// KNOWN-BENIGN allowlist: all three warnings live INSIDE circomlib templates
// pulled in by EdDSAPoseidonVerifier (eddsaposeidon.circom), never ours:
//   - CompConstant(...): num2bits.out bits unused by the father component
//     (fully constrained inside Num2Bits) — subgroup-order + alias checks.
//   - EscalarMulAny(254) / EscalarMulFix(253, ...): last segment's dbl output
//     is unused by construction.
// Fixing them would mean patching circomlib in node_modules — out of scope.
// Everything in circuits/delivery.circom + circuits/lib/ is --inspect clean.
const ALLOWED_WARNINGS = [
  'In template "CompConstant(',
  'In template "EscalarMulAny(254)"',
  'In template "EscalarMulFix(253,',
];
{
  const res = spawnSync('circom', [
    path.join('circuits', 'delivery.circom'),
    '--r1cs', '--wasm', '--sym', '--inspect',
    '-l', path.join('circuits', 'node_modules'),
    '-o', path.join('circuits', 'build'),
  ], { cwd: repoRoot, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`circom failed:\n${res.stdout}\n${res.stderr}`);
  const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  const warnings = out.split('\n').filter((l) => l.includes('warning'));
  const unexpected = warnings.filter((w) => !ALLOWED_WARNINGS.some((a) => w.includes(a)));
  check('inspect_gate(delivery): --inspect clean outside circomlib internals',
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
const CARRIER_SEED = seed(0x01);   // parity identity — carrier
const RECIPIENT_SEED = seed(0x21); // parity identity — recipient

const DOM_PODMSG = 5n;
const DOM_PKC = 7n;
const DOM_CELL = 9n;

function signPod(prv, m) {
  const sig = eddsa.signPoseidon(prv, bjF.e(m));
  return {
    sig_R8x: bjF.toObject(sig.R8[0]).toString(),
    sig_R8y: bjF.toObject(sig.R8[1]).toString(),
    sig_S: sig.S.toString(),
  };
}

// ── fixtures ─────────────────────────────────────────────────────────────────
const input = JSON.parse(readFileSync(path.join(fixtureDir, 'input.json'), 'utf8'));
const meta = JSON.parse(readFileSync(path.join(fixtureDir, 'meta.json'), 'utf8'));

async function loadWitnessCalculator() {
  const dir = path.join(buildDir, 'delivery_js');
  // circom emits CommonJS; circuits/package.json is "type":"module" — copy to
  // .cjs (build dir is gitignored) so node loads it as CommonJS.
  const cjs = path.join(dir, 'witness_calculator.cjs');
  copyFileSync(path.join(dir, 'witness_calculator.js'), cjs);
  const builder = require(cjs);
  return builder(readFileSync(path.join(dir, 'delivery.wasm')));
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

// ── negative 1 (T8 stolen_pod_sig): signature by the WRONG key ──────────────
// Carrier signs the (correct) PoD message instead of the recipient committed
// in C_S — EdDSAPoseidonVerifier must reject against recipient_pk.
{
  const bad = { ...input, ...signPod(CARRIER_SEED, BigInt(meta.aux.pod_msg)) };
  const res = await tryWitness(bad);
  check('T8: PoD signed by carrier key instead of recipient rejected', !res.ok,
    'witness unexpectedly satisfied');
}

// ── negative 2: PoD location OUTSIDE the committed dest region ──────────────
// Shift lat by 10 r=17 cells (10·2^7 lat_q units). The recipient honestly
// re-signs the message over the NEW cell, so the signature is valid and the
// ONLY failing constraint is dest-region Merkle membership.
{
  const latQ = BigInt(input.lat_q) + 10n * 2n ** 7n;
  const lonQ = BigInt(input.lon_q);
  let cell = 0n;
  for (let j = 0n; j < 17n; j++) { // normative Morton mapping (geocell.circom)
    cell |= (((latQ >> (7n + j)) & 1n) << (2n * j + 1n));
    cell |= (((lonQ >> (7n + j)) & 1n) << (2n * j));
  }
  const m = P(DOM_PODMSG, BigInt(input.shipment_id), BigInt(meta.carrier_pk_commit), cell, BigInt(input.ts));
  const bad = { ...input, lat_q: latQ.toString(), ...signPod(RECIPIENT_SEED, m) };
  const res = await tryWitness(bad);
  check('location shifted 10 cells outside dest region rejected', !res.ok,
    'witness unexpectedly satisfied');
}

// ── negative 3 (T13 pad_membership probe): path pointing at a PAD slot ──────
// Classic probe: dest_path/dest_path_index form the PERFECTLY CONSISTENT
// authentication path of PAD slot 9 (leaf = PAD reproduces the root exactly).
// In A1 the leaf is derived in-circuit as Poseidon(DOM_CELL, cell) and can
// never equal PAD = Poseidon(0,0), so the probe must fail; the direct
// leaf-as-witness PAD injection against MerkleInclusion's leaf != PAD()
// constraint is covered at gadget level by test/gadgets/pad_membership.test.mjs.
{
  const leaves = meta.aux.grid_cells.map((c) => P(DOM_CELL, BigInt(c)));
  while (leaves.length < 64) leaves.push(PAD);
  const levels = [leaves];
  let cur = leaves;
  while (cur.length > 1) {
    const next = [];
    for (let i = 0; i < cur.length; i += 2) next.push(h2(cur[i], cur[i + 1]));
    levels.push(next);
    cur = next;
  }
  check('rebuilt grid tree matches committed dest_region_root',
    levels[6][0].toString() === meta.aux.dest_region_root,
    `root ${levels[6][0]} != ${meta.aux.dest_region_root}`);

  const PAD_SLOT = 9; // first padding slot after the 9 real leaves
  const pathElements = [];
  const pathIndices = [];
  let idx = PAD_SLOT;
  for (let lvl = 0; lvl < 6; lvl++) {
    pathElements.push(levels[lvl][(idx & 1) === 0 ? idx + 1 : idx - 1].toString());
    pathIndices.push((idx & 1).toString());
    idx >>= 1;
  }
  // Sanity: the probe path IS consistent for leaf = PAD.
  let node = PAD;
  idx = PAD_SLOT;
  for (const sib of pathElements) {
    node = (idx & 1) === 0 ? h2(node, BigInt(sib)) : h2(BigInt(sib), node);
    idx >>= 1;
  }
  check('T13 probe path is consistent for leaf = PAD (probe is well-formed)',
    node.toString() === meta.aux.dest_region_root);

  const bad = { ...input, dest_path: pathElements, dest_path_index: pathIndices };
  const res = await tryWitness(bad);
  check('T13: PAD-slot membership attempt rejected', !res.ok, 'witness unexpectedly satisfied');
}

// ── negative 4: tampered C_S field (qty 2 → 3, everything else unchanged) ───
{
  const bad = { ...input, qty: '3' };
  const res = await tryWitness(bad);
  check('tampered C_S opening (qty=3) rejected', !res.ok, 'witness unexpectedly satisfied');
}

// ── negative 5 (T14 overflow_probe): ts = 2^33 breaks AssertBits(32) ────────
// The recipient "cooperates" by signing the overflowed message, so the ONLY
// failing constraint is the strict 32-bit decomposition of ts.
{
  const ts = 2n ** 33n;
  const m = P(DOM_PODMSG, BigInt(input.shipment_id), BigInt(meta.carrier_pk_commit),
    BigInt(meta.aux.cell_rd), ts);
  const bad = { ...input, ts: ts.toString(), ...signPod(RECIPIENT_SEED, m) };
  const res = await tryWitness(bad);
  check('T14: ts = 2^33 rejected by AssertBits(32)', !res.ok, 'witness unexpectedly satisfied');
}

// ── negative 6: wrong carrier_pk_commit opening (pk_blind = 99999) ──────────
// Recipient re-signs over the forged commit so the failure is isolated to the
// head equation, not the signature.
{
  const pkc = P(DOM_PKC, BigInt(input.pk_x), BigInt(input.pk_y), 99999n);
  const m = P(DOM_PODMSG, BigInt(input.shipment_id), pkc, BigInt(meta.aux.cell_rd), BigInt(input.ts));
  const bad = { ...input, pk_blind: '99999', ...signPod(RECIPIENT_SEED, m) };
  const res = await tryWitness(bad);
  check('wrong carrier_pk_commit (pk_blind=99999) rejected by head equation', !res.ok,
    'witness unexpectedly satisfied');
}

// ── committed proof fixture verifies + pub_signals order pinned ─────────────
{
  const vk = JSON.parse(readFileSync(path.join(fixtureDir, 'verification_key.json'), 'utf8'));
  const proof = JSON.parse(readFileSync(path.join(fixtureDir, 'proof.json'), 'utf8'));
  const publics = JSON.parse(readFileSync(path.join(fixtureDir, 'public.json'), 'utf8'));

  const expected = [meta.shipment_id, meta.c_s, meta.head, meta.nullifier, meta.ts];
  check('public.json order = [shipment_id, c_s, head, nullifier, ts]',
    JSON.stringify(publics.map((v) => BigInt(v).toString())) === JSON.stringify(expected));

  const ok = await snarkjs.groth16.verify(vk, publics, proof);
  check('snarkjs groth16 verify of committed proof fixture OK', ok === true);
}

// ── fresh end-to-end prove + verify (only when the local zkey exists) ────────
{
  const zkey = path.join(buildDir, 'delivery_final.zkey');
  if (existsSync(zkey)) {
    const vk = JSON.parse(readFileSync(path.join(fixtureDir, 'verification_key.json'), 'utf8'));
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input, path.join(buildDir, 'delivery_js', 'delivery.wasm'), zkey);
    const ok = await snarkjs.groth16.verify(vk, publicSignals, proof);
    check('fresh groth16 prove + verify from honest witness OK', ok === true);
  } else {
    console.log('SKIP fresh prove (circuits/build/delivery_final.zkey not present — run build.mjs setup)');
  }
}

process.exit(failures ? 1 : 0);
