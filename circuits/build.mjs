#!/usr/bin/env node
/**
 * build.mjs — minimal circom build driver for Aegis Relay.
 *
 * Subcommands:
 *   compile <path/to/circuit.circom> [outdir]
 *       circom --r1cs --wasm --sym -o <outdir> -l circuits/node_modules
 *       (outdir defaults to circuits/build; created if missing)
 *   witness <name> <input.json> <out.wtns> [outdir]
 *       node <outdir>/<name>_js/generate_witness.js <name>.wasm input out
 *   setup <name> <ptau> [outdir]
 *       snarkjs groth16 setup + one zkey contribution (random entropy) →
 *       <outdir>/<name>_final.zkey (gitignored) and
 *       circuits/fixtures/<name>/verification_key.json (committed).
 *       The ptau MUST be sized from the measured .r1cs: 2·constraints ≤ 2^k
 *       (hard rule 5) — check `snarkjs r1cs info` first, never guess.
 *   prove <name> <input.json> [outdir]
 *       witness + groth16 prove with <outdir>/<name>_final.zkey →
 *       circuits/fixtures/<name>/{proof.json,public.json} (committed).
 *
 * Run with node (never bun). circom 2.2.3 must be on PATH.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CIRCUITS_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTDIR = join(CIRCUITS_DIR, 'build');
const CIRCOMLIB_ROOT = join(CIRCUITS_DIR, 'node_modules');
const FIXTURES_DIR = join(CIRCUITS_DIR, 'fixtures');
const SNARKJS_CLI = join(CIRCUITS_DIR, 'node_modules', 'snarkjs', 'cli.js');

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.error) throw res.error;
  if (res.status !== 0) process.exit(res.status ?? 1);
}

function compile(circuitPath, outdir = DEFAULT_OUTDIR) {
  if (!circuitPath) usage('compile: missing <path/to/circuit.circom>');
  const src = resolve(circuitPath);
  if (!existsSync(src)) usage(`compile: no such circuit: ${src}`);
  mkdirSync(outdir, { recursive: true });
  // circom's generated <name>_js/generate_witness.js is CommonJS, but
  // circuits/package.json declares "type": "module" — pin the build tree back
  // to commonjs so `node generate_witness.js` keeps working.
  writeFileSync(join(outdir, 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');
  run('circom', [src, '--r1cs', '--wasm', '--sym', '-o', outdir, '-l', CIRCOMLIB_ROOT]);
  console.log(`[build] compiled ${src} -> ${outdir}`);
}

function witness(name, inputJson, outWtns, outdir = DEFAULT_OUTDIR) {
  if (!name || !inputJson || !outWtns) {
    usage('witness: expected <name> <input.json> <out.wtns>');
  }
  const jsDir = join(outdir, `${name}_js`);
  const genWitness = join(jsDir, 'generate_witness.js');
  if (!existsSync(genWitness)) {
    usage(`witness: ${genWitness} not found — run \`compile\` first`);
  }
  run('node', [genWitness, join(jsDir, `${name}.wasm`), resolve(inputJson), resolve(outWtns)]);
  console.log(`[build] witness ${name} -> ${resolve(outWtns)}`);
}

// snarkjs CLI wrapper — always through node (never bun), pinned to the
// circuits/node_modules copy.
function snarkjs(...args) {
  run('node', [SNARKJS_CLI, ...args]);
}

// Groth16 phase-2: setup + one contribution with fresh random entropy, then
// export the verification key into the committed fixtures tree. zkeys stay in
// <outdir> (gitignored — *.zkey). Regenerating a zkey invalidates any deployed
// contract holding the old VK (hard rule 5) — redeploy together.
function setup(name, ptauPath, outdir = DEFAULT_OUTDIR) {
  if (!name || !ptauPath) usage('setup: expected <name> <ptau>');
  const r1cs = join(outdir, `${name}.r1cs`);
  if (!existsSync(r1cs)) usage(`setup: ${r1cs} not found — run \`compile\` first`);
  const ptau = resolve(ptauPath);
  if (!existsSync(ptau)) usage(`setup: no such ptau: ${ptau}`);

  const zkey0 = join(outdir, `${name}_0000.zkey`);
  const zkeyFinal = join(outdir, `${name}_final.zkey`);
  const fixtureDir = join(FIXTURES_DIR, name);
  mkdirSync(fixtureDir, { recursive: true });

  snarkjs('groth16', 'setup', r1cs, ptau, zkey0);
  snarkjs(
    'zkey', 'contribute', zkey0, zkeyFinal,
    `--name=${name} phase2 contribution`,
    `-e=${randomBytes(32).toString('hex')}`,
  );
  snarkjs('zkey', 'export', 'verificationkey', zkeyFinal, join(fixtureDir, 'verification_key.json'));
  console.log(`[build] setup ${name}: ${zkeyFinal}`);
  console.log(`[build] vk -> ${join(fixtureDir, 'verification_key.json')}`);
}

// Witness + groth16 prove against <outdir>/<name>_final.zkey; proof/publics
// land in the committed fixtures tree.
function prove(name, inputJson, outdir = DEFAULT_OUTDIR) {
  if (!name || !inputJson) usage('prove: expected <name> <input.json>');
  const zkeyFinal = join(outdir, `${name}_final.zkey`);
  if (!existsSync(zkeyFinal)) usage(`prove: ${zkeyFinal} not found — run \`setup\` first`);
  const fixtureDir = join(FIXTURES_DIR, name);
  mkdirSync(fixtureDir, { recursive: true });

  const wtns = join(outdir, `${name}.wtns`);
  witness(name, inputJson, wtns, outdir);
  snarkjs(
    'groth16', 'prove', zkeyFinal, wtns,
    join(fixtureDir, 'proof.json'),
    join(fixtureDir, 'public.json'),
  );
  console.log(`[build] prove ${name} -> ${join(fixtureDir, 'proof.json')} + public.json`);
}

function usage(err) {
  if (err) console.error(`error: ${err}\n`);
  console.error(
    'usage:\n' +
      '  node circuits/build.mjs compile <path/to/circuit.circom> [outdir]\n' +
      '  node circuits/build.mjs witness <name> <input.json> <out.wtns> [outdir]\n' +
      '  node circuits/build.mjs setup <name> <ptau> [outdir]\n' +
      '  node circuits/build.mjs prove <name> <input.json> [outdir]',
  );
  process.exit(err ? 1 : 0);
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case 'compile':
    compile(args[0], args[1]);
    break;
  case 'witness':
    witness(args[0], args[1], args[2], args[3]);
    break;
  case 'setup':
    setup(args[0], args[1], args[2]);
    break;
  case 'prove':
    prove(args[0], args[1], args[2]);
    break;
  default:
    usage(cmd ? `unknown subcommand: ${cmd}` : undefined);
}
