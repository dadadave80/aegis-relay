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
 *
 * No ceremony (ptau/zkey) commands yet — those land with the first real
 * circuit; ptau size must come from the measured .r1cs (hard rule 5).
 *
 * Run with node (never bun). circom 2.2.3 must be on PATH.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CIRCUITS_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTDIR = join(CIRCUITS_DIR, 'build');
const CIRCOMLIB_ROOT = join(CIRCUITS_DIR, 'node_modules');

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

function usage(err) {
  if (err) console.error(`error: ${err}\n`);
  console.error(
    'usage:\n' +
      '  node circuits/build.mjs compile <path/to/circuit.circom> [outdir]\n' +
      '  node circuits/build.mjs witness <name> <input.json> <out.wtns> [outdir]',
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
  default:
    usage(cmd ? `unknown subcommand: ${cmd}` : undefined);
}
