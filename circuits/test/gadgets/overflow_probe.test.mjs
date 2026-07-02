// overflow_probe.test.mjs — threat T14: field wraparound in comparisons.
// LtChecked(32)/LeqChecked(32) must REJECT any operand outside the declared
// 32-bit width (AssertBits/Num2Bits catches it during witness generation),
// and must compare correctly for in-range values.
//
// Run from repo root: node circuits/test/gadgets/overflow_probe.test.mjs

import { readFileSync, copyFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

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
  check(`inspect_gate(${name}): --inspect clean (allowlisted: circomlib LessThan internals)`,
    unexpected.length === 0, unexpected.join(' | '));
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

// KNOWN-BENIGN allowlisted warning: circomlib's own LessThan(n) leaves
// n2b.out[0..n-1] unreferenced in its template body (only out[n] is used).
// Those bits ARE fully constrained inside Num2Bits (binary + weighted-sum);
// fixing the warning would require patching circomlib in node_modules, which
// is out of scope. Everything in circuits/lib/ itself is --inspect clean.
compile('cmp_main', ['In template "LessThan(32)"']);

const wc = await loadWitnessCalculator('cmp_main');

async function run(a, b) {
  try {
    const w = await wc.calculateWitness({ a, b }, true);
    // Witness layout: w[0]=1, then main outputs in declaration order.
    return { ok: true, lt: w[1], leq: w[2] };
  } catch (e) {
    return { ok: false, err: String(e.message ?? e) };
  }
}

// Out-of-width operand (a = 2^33) must FAIL despite being a "small" field element.
{
  const res = await run(2n ** 33n, 7n);
  check('T14: a=2^33 rejected by AssertBits(32)', !res.ok, `witness unexpectedly satisfied (lt=${res.lt})`);
}
// Same for b, and for a just past the boundary.
{
  const res = await run(5n, 2n ** 32n);
  check('T14: b=2^32 rejected by AssertBits(32)', !res.ok, 'witness unexpectedly satisfied');
}
// Field-wraparound probe: a = p - 1 (== -1 mod p) must not pass as "negative".
{
  const p = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const res = await run(p - 1n, 7n);
  check('T14: a=p-1 rejected by AssertBits(32)', !res.ok, 'witness unexpectedly satisfied');
}

// In-range comparisons.
{
  const res = await run(5n, 7n);
  check('a=5 < b=7: out=1', res.ok && res.lt === 1n && res.leq === 1n,
    res.ok ? `lt=${res.lt} leq=${res.leq}` : res.err);
}
{
  const res = await run(7n, 5n);
  check('a=7 < b=5: out=0', res.ok && res.lt === 0n && res.leq === 0n,
    res.ok ? `lt=${res.lt} leq=${res.leq}` : res.err);
}
{
  const res = await run(7n, 7n);
  check('a=7, b=7: lt=0, leq=1', res.ok && res.lt === 0n && res.leq === 1n,
    res.ok ? `lt=${res.lt} leq=${res.leq}` : res.err);
}
{
  const max = 2n ** 32n - 1n;
  const res = await run(max, max);
  check('a=b=2^32-1 (max in-range): lt=0, leq=1', res.ok && res.lt === 0n && res.leq === 1n,
    res.ok ? `lt=${res.lt} leq=${res.leq}` : res.err);
}
{
  const res = await run(0n, 2n ** 32n - 1n);
  check('a=0 < b=2^32-1: lt=1, leq=1', res.ok && res.lt === 1n && res.leq === 1n,
    res.ok ? `lt=${res.lt} leq=${res.leq}` : res.err);
}

process.exit(failures ? 1 : 0);
