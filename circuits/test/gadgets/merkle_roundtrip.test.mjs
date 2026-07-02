// merkle_roundtrip.test.mjs — MerkleInclusion(3) round-trip + tamper test.
//
// Builds a depth-3 tree in JS with circomlibjs using the SAME convention as
// contracts/poseidon-merkle/src/merkle.rs (even index = left child; PAD =
// poseidon2(0,0) zero-leaf padding), cross-checks the path walk against a
// direct JS port of the Rust `root_from_path`, then proves membership for
// index 0 and index 5 in the circuit. A tampered sibling must fail witness
// generation.
//
// Run from repo root: node circuits/test/gadgets/merkle_roundtrip.test.mjs

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

// --- compile harness with --inspect; any warning fails the test (T15) ---
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

// --- main ---
compile('merkle_main');

const poseidon = await buildPoseidon();
const F = poseidon.F;
const h2 = (a, b) => F.toObject(poseidon([a, b]));

// PAD = poseidon2(0,0) — must equal the literal in circuits/lib/constants.circom.
const PAD = h2(0n, 0n);
check('PAD literal parity with constants.circom',
  PAD === 14744269619966411208579211824598458697587494354926760081771325075741142829156n,
  `computed ${PAD}`);

// Depth-3 tree: 6 real leaves padded to 8 with PAD (Rust pad_pow2 convention).
const DEPTH = 3;
const leaves = [11n, 22n, 33n, 44n, 55n, 66n, PAD, PAD];

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

// Direct JS port of contracts/poseidon-merkle/src/merkle.rs::root_from_path:
// even index -> poseidon2(node, sib); odd -> poseidon2(sib, node); idx >>= 1.
function rootFromPathRust(leaf, pathElements, index) {
  let node = leaf;
  let idx = index;
  for (const sib of pathElements) {
    node = (idx & 1) === 0 ? h2(node, sib) : h2(sib, node);
    idx >>= 1;
  }
  return node;
}

const levels = buildLevels(leaves);
const root = levels[DEPTH][0];

// Cross-check: the Rust-convention path walk reproduces the tree root.
for (const idx of [0, 5]) {
  const { pathElements } = genPath(levels, idx);
  check(`rust-convention cross-check (index ${idx})`,
    rootFromPathRust(leaves[idx], pathElements, idx) === root);
}

const wc = await loadWitnessCalculator('merkle_main');

async function tryWitness(input) {
  try {
    await wc.calculateWitness(input, true); // sanityCheck=true: throws on violated constraints
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e.message ?? e) };
  }
}

// Valid membership for index 0 and index 5 must satisfy the circuit.
for (const idx of [0, 5]) {
  const { pathElements, pathIndices } = genPath(levels, idx);
  const res = await tryWitness({
    leaf: leaves[idx],
    pathElements,
    pathIndices: pathIndices.map(BigInt),
    expectedRoot: root,
  });
  check(`witness satisfies for index ${idx}`, res.ok, res.err ?? '');
}

// A tampered sibling must fail witness generation / constraint check.
{
  const { pathElements, pathIndices } = genPath(levels, 5);
  const tampered = [...pathElements];
  tampered[1] = tampered[1] + 1n;
  const res = await tryWitness({
    leaf: leaves[5],
    pathElements: tampered,
    pathIndices: pathIndices.map(BigInt),
    expectedRoot: root,
  });
  check('tampered sibling rejected', !res.ok, 'witness unexpectedly satisfied');
}

// A non-boolean path index must be rejected by the b*(b-1)===0 constraint.
{
  const { pathElements, pathIndices } = genPath(levels, 0);
  const badIndices = pathIndices.map(BigInt);
  badIndices[0] = 2n;
  const res = await tryWitness({
    leaf: leaves[0],
    pathElements,
    pathIndices: badIndices,
    expectedRoot: root,
  });
  check('non-boolean path index rejected', !res.ok, 'witness unexpectedly satisfied');
}

process.exit(failures ? 1 : 0);
