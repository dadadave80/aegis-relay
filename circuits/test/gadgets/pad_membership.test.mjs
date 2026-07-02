// pad_membership.test.mjs — threat T13: padding leaves must never be provable
// members. A witness where leaf == PAD = poseidon2(0,0), with a path that is
// otherwise perfectly consistent with the tree root, MUST fail witness
// generation (the leaf != PAD() constraint in MerkleInclusion).
//
// Run from repo root: node circuits/test/gadgets/pad_membership.test.mjs

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

compile('merkle_main');

const poseidon = await buildPoseidon();
const F = poseidon.F;
const h2 = (a, b) => F.toObject(poseidon([a, b]));
const PAD = h2(0n, 0n);

const DEPTH = 3;
// Tree with real leaves 0..5 and PAD padding at indices 6,7 — exactly the
// shape an attacker would target: PAD sits in the tree with a fully valid
// authentication path.
const leaves = [101n, 202n, 303n, 404n, 505n, 606n, PAD, PAD];

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
    pathIndices.push(BigInt(idx & 1));
    idx >>= 1;
  }
  return { pathElements, pathIndices };
}

function rootFromPath(leaf, pathElements, index) {
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
const wc = await loadWitnessCalculator('merkle_main');

async function tryWitness(input) {
  try {
    await wc.calculateWitness(input, true);
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e.message ?? e) };
  }
}

// Sanity: a real leaf with a valid path still satisfies (the fixture is sound).
{
  const { pathElements, pathIndices } = genPath(levels, 2);
  const res = await tryWitness({ leaf: leaves[2], pathElements, pathIndices, expectedRoot: root });
  check('fixture sanity: real leaf satisfies', res.ok, res.err ?? '');
}

// T13 core: leaf == PAD at index 6 — the path IS hash-consistent with root
// (confirmed in JS below), yet the circuit MUST reject it.
{
  const { pathElements, pathIndices } = genPath(levels, 6);
  check('JS sanity: PAD path is hash-consistent with root',
    rootFromPath(PAD, pathElements, 6) === root);
  const res = await tryWitness({ leaf: PAD, pathElements, pathIndices, expectedRoot: root });
  check('T13: PAD leaf with valid path rejected', !res.ok, 'PAD membership unexpectedly provable');
}

// T13 variant: fully attacker-chosen all-PAD tree (empty-tree trick).
{
  const padLevels = buildLevels([PAD, PAD, PAD, PAD, PAD, PAD, PAD, PAD]);
  const padRoot = padLevels[DEPTH][0];
  const { pathElements, pathIndices } = genPath(padLevels, 0);
  const res = await tryWitness({ leaf: PAD, pathElements, pathIndices, expectedRoot: padRoot });
  check('T13: PAD leaf in all-PAD tree rejected', !res.ok, 'empty-tree membership unexpectedly provable');
}

process.exit(failures ? 1 : 0);
