// digest.test.mjs — FlightDigest(3) vs a circomlibjs JS reference chain.
//
//   d_0 = Poseidon(DOM_FLIGHT=10, shipment_id)
//   d_{i+1} = Poseidon(d_i, lat_q[i], lon_q[i], alt_dm[i], t[i]), i = 0..N-1
//   output = d_N (all N waypoints absorbed; d_1 uses waypoint 0)
//
// Run from repo root: node circuits/test/gadgets/digest.test.mjs

import { readFileSync, copyFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { buildPoseidon } from 'circomlibjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const require = createRequire(import.meta.url);

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`PASS ${name}`);
  else { failures++; console.log(`FAIL ${name}${extra ? ' -- ' + extra : ''}`); }
}

function compile(name, allowedWarnings = []) {
  const res = spawnSync('circom', [
    path.join('circuits', 'test', 'gadgets', `${name}.circom`),
    '--r1cs', '--wasm', '--inspect',
    '-l', path.join('circuits', 'node_modules'),
    '-o', path.join('circuits', 'build', 'gadgets'),
  ], { cwd: repoRoot, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`circom failed for ${name}:\n${res.stdout}\n${res.stderr}`);
  const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  const warnings = out.split('\n').filter((l) => l.includes('warning'));
  const unexpected = warnings.filter((w) => !allowedWarnings.some((a) => w.includes(a)));
  check(`inspect_gate(${name}): --inspect clean`, unexpected.length === 0, unexpected.join(' | '));
}

async function loadWitnessCalculator(name) {
  const dir = path.join(repoRoot, 'circuits', 'build', 'gadgets', `${name}_js`);
  // circom emits a CommonJS witness_calculator.js, but circuits/package.json
  // is "type":"module" — copy to .cjs (build dir is gitignored) so node
  // loads it as CommonJS.
  const cjs = path.join(dir, 'witness_calculator.cjs');
  copyFileSync(path.join(dir, 'witness_calculator.js'), cjs);
  const builder = require(cjs);
  return builder(readFileSync(path.join(dir, `${name}.wasm`)));
}

compile('digest_main');

const poseidon = await buildPoseidon();
const F = poseidon.F;
const H = (inputs) => F.toObject(poseidon(inputs));
const DOM_FLIGHT = 10n;
const N = 3;

function jsDigest(shipmentId, latQ, lonQ, altDm, t) {
  let d = H([DOM_FLIGHT, shipmentId]);
  for (let i = 0; i < N; i++) {
    d = H([d, latQ[i], lonQ[i], altDm[i], t[i]]);
  }
  return d;
}

const shipmentId = 123456789n;
const latQ = [8388608n, 8388700n, 8388811n];       // 24-bit range
const lonQ = [4194304n, 4194500n, 4194777n];
const altDm = [500n, 750n, 1100n];                  // 16-bit range
const t = [1700000000n, 1700000010n, 1700000025n];  // 32-bit range

const wc = await loadWitnessCalculator('digest_main');

async function circuitDigest(sid, la, lo, al, tt) {
  // Witness layout: w[0]=1, then main outputs in declaration order: digest.
  const w = await wc.calculateWitness(
    { shipment_id: sid, lat_q: la, lon_q: lo, alt_dm: al, t: tt }, true);
  return w[1];
}

// Circuit digest equals the JS reference chain.
{
  const expected = jsDigest(shipmentId, latQ, lonQ, altDm, t);
  const got = await circuitDigest(shipmentId, latQ, lonQ, altDm, t);
  check('FlightDigest(3) equals JS reference chain', got === expected,
    `circuit=${got} js=${expected}`);
}

// T7 binding: a different shipment_id yields a different digest (d_0 domain).
{
  const got = await circuitDigest(987654321n, latQ, lonQ, altDm, t);
  const original = jsDigest(shipmentId, latQ, lonQ, altDm, t);
  check('different shipment_id changes digest (T7 binding)', got !== original);
  check('different shipment_id still matches its own JS reference',
    got === jsDigest(987654321n, latQ, lonQ, altDm, t));
}

// ALL waypoints are absorbed: perturbing the FIRST waypoint (the d_1 <- w_0
// off-by-one trap) and the LAST waypoint each change the digest.
{
  const laFirst = [latQ[0] + 1n, latQ[1], latQ[2]];
  const gotFirst = await circuitDigest(shipmentId, laFirst, lonQ, altDm, t);
  check('perturbing waypoint 0 changes digest (absorbed, no off-by-one)',
    gotFirst !== jsDigest(shipmentId, latQ, lonQ, altDm, t));
  check('perturbed-waypoint-0 digest matches JS reference',
    gotFirst === jsDigest(shipmentId, laFirst, lonQ, altDm, t));

  const tLast = [t[0], t[1], t[2] + 1n];
  const gotLast = await circuitDigest(shipmentId, latQ, lonQ, altDm, tLast);
  check('perturbing waypoint N-1 changes digest',
    gotLast !== jsDigest(shipmentId, latQ, lonQ, altDm, t));
  check('perturbed-last-waypoint digest matches JS reference',
    gotLast === jsDigest(shipmentId, latQ, lonQ, altDm, tLast));
}

process.exit(failures ? 1 : 0);
