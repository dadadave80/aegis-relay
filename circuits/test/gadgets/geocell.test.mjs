// geocell.test.mjs — Cell(r)/CellLeaf(r) vs an independent JS Morton
// reference, for r=15 (RC corridor) and r=17 (RD destination region).
//
// NORMATIVE mapping (must match circuits/lib/geocell.circom, the TS corridor
// tool, and the drone simulator): take the TOP r bits of the 24-bit lat_q and
// lon_q (bits 23 down to 24-r); with lat_top/lon_top as r-bit values and bit
// j (j=0 their LSB), cell = sum_j lat_top_bit_j * 2^(2j+1) + lon_top_bit_j *
// 2^(2j) — LAT in the HIGHER (odd) bit of each pair.
//
// Run from repo root: node circuits/test/gadgets/geocell.test.mjs

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

// Independent JS reference of the NORMATIVE Morton mapping.
function mortonCell(latQ, lonQ, r) {
  let cell = 0n;
  for (let j = 0; j < r; j++) {
    const latBit = (latQ >> BigInt(24 - r + j)) & 1n;
    const lonBit = (lonQ >> BigInt(24 - r + j)) & 1n;
    cell |= latBit << BigInt(2 * j + 1); // lat -> odd (higher) position
    cell |= lonBit << BigInt(2 * j);     // lon -> even (lower) position
  }
  return cell;
}

compile('geocell15_main');
compile('geocell17_main');

const poseidon = await buildPoseidon();
const F = poseidon.F;
const DOM_CELL = 9n;

// Hand-computed anchor (guards against a common-mode bug in circuit AND JS
// reference): lat=0xAAAAAA, lon=0, r=15. Top 15 bits of 0xAAAAAA are
// 0b101010101010101 (bit j set for even j), so cell has bits at 2j+1 for
// even j: positions 1,5,9,...,29 => sum_{k=0}^{7} 2^(4k+1) = 572662306.
check('hand-computed anchor r=15 lat=0xAAAAAA lon=0',
  mortonCell(0xAAAAAAn, 0n, 15) === 572662306n,
  `got ${mortonCell(0xAAAAAAn, 0n, 15)}`);
// Mirror anchor: lon carries the same pattern in even positions => half the value.
check('hand-computed anchor r=15 lat=0 lon=0xAAAAAA',
  mortonCell(0n, 0xAAAAAAn, 15) === 286331153n,
  `got ${mortonCell(0n, 0xAAAAAAn, 15)}`);

// Test vectors: edges (0, 2^24-1), asymmetric lat/lon patterns to catch
// bit-order swaps, and mixed values.
const vectors = [
  [0n, 0n],
  [0xFFFFFFn, 0xFFFFFFn],
  [0xAAAAAAn, 0x000000n], // lat-only pattern: swaps lat/lon or odd/even would break
  [0x000000n, 0xAAAAAAn], // lon-only mirror
  [0x123456n, 0xFEDCBAn],
  [0x800000n, 0x000001n], // top lat bit + bottom lon bit (dropped for r<24)
];

for (const r of [15, 17]) {
  const wc = await loadWitnessCalculator(`geocell${r}_main`);
  for (const [latQ, lonQ] of vectors) {
    const expectedCell = mortonCell(latQ, lonQ, r);
    const expectedLeaf = F.toObject(poseidon([DOM_CELL, expectedCell]));
    // Witness layout: w[0]=1, then outputs in declaration order: cell, leaf.
    const w = await wc.calculateWitness({ lat_q: latQ, lon_q: lonQ }, true);
    check(`r=${r} lat=0x${latQ.toString(16)} lon=0x${lonQ.toString(16)} cell`,
      w[1] === expectedCell, `circuit=${w[1]} js=${expectedCell}`);
    check(`r=${r} lat=0x${latQ.toString(16)} lon=0x${lonQ.toString(16)} leaf`,
      w[2] === expectedLeaf, `circuit=${w[2]} js=${expectedLeaf}`);
  }
  // Out-of-width coordinate must be rejected by the strict 24-bit decomposition.
  let rejected = false;
  try { await wc.calculateWitness({ lat_q: 2n ** 24n, lon_q: 0n }, true); }
  catch { rejected = true; }
  check(`r=${r} lat_q=2^24 rejected by Num2Bits(24)`, rejected);
}

process.exit(failures ? 1 : 0);
