// dronesim-attacks.test.mjs — CI-facing proof that the drone simulator's attack
// modes genuinely cannot produce an accepting A2 flight proof (DESIGN §11.3,
// §12 rows T5–T7). Plain node; exits nonzero on any failure.
//
//   honest  → assemble the SAME witness as circuits/fixtures/flight/input.json
//             (regression pin), snarkjs fullProve, verify vs the committed
//             verification_key.json → MUST PASS (slow, ~2–5 min for 70k gates).
//   attacks → stray, teleport, gap, nonmono, splice, heavy, altitude,
//             foreign-key → each MUST be REJECTED (witness-generation failure,
//             or, if a witness is somehow produced, on-chain verify == false).
//
// The simulator logic under test lives in prover/src/lib/flight.ts; this suite
// drives it directly (dronesim.ts is a thin CLI wrapper over the same module).
//
// Run: node --import tsx/esm prover/test-e2e/dronesim-attacks.test.mjs

import { readFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import {
  buildFlightScenario,
  applyAttack,
  deriveDroneKey,
  ATTACK_MODES,
  ATTACK_NOTES,
} from '../src/lib/flight.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureDir = path.join(repoRoot, 'circuits', 'fixtures', 'flight');
const buildDir = path.join(repoRoot, 'circuits', 'build');
const require = createRequire(import.meta.url);
const snarkjs = require('snarkjs');

// Fixture lane params (DESIGN scenario provenance; == gen-flight-fixtures.mjs).
const FROM = { lat: '6.4900', lon: '3.3500' };
const TO = { lat: '6.5244', lon: '3.3792' };
const LANE_ID = 7;
// Drone (== custody) key: seed bytes 0x01..0x20, pk_blind 12345.
const DRONE_SEED_HEX = Buffer.from(Array.from({ length: 32 }, (_, i) => 0x01 + i)).toString('hex');

let failures = 0;
const line = (verdict, mode, extra) =>
  console.log(`${verdict} ${mode}${extra ? ' — ' + extra : ''}`);

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Rebuild the honest scenario from the pinned fixture opening ───────────────
const input = JSON.parse(readFileSync(path.join(fixtureDir, 'input.json'), 'utf8'));
const vk = JSON.parse(readFileSync(path.join(fixtureDir, 'verification_key.json'), 'utf8'));

const droneKey = await deriveDroneKey(DRONE_SEED_HEX, input.pk_blind);
const scenario = await buildFlightScenario({
  shipmentId: input.shipment_id,
  opening: {
    skuHash: input.sku_hash,
    qty: input.qty,
    weightG: input.weight_g,
    valueUnits: input.value_units,
    recipientPkX: input.recipient_pk_x,
    recipientPkY: input.recipient_pk_y,
    method: input.method,
    deadlineTs: input.deadline_ts,
    shipmentSecret: input.shipment_secret,
  },
  from: FROM,
  to: TO,
  droneKey,
  laneId: LANE_ID,
  t0: 1_800_000_000n,
  dt: 20n,
  altDm: 800n,
});

// Regression: the honest witness must be byte-identical to the committed fixture.
{
  const same = deepEqual(scenario.witness, input);
  if (!same) failures++;
  console.log(`regression: honest witness == fixtures/flight/input.json: ${same}`);
}

// ── Witness calculator (fast rejection path for the attacks) ─────────────────
async function loadWitnessCalculator() {
  const dir = path.join(buildDir, 'flight_js');
  const cjs = path.join(dir, 'witness_calculator.cjs');
  copyFileSync(path.join(dir, 'witness_calculator.js'), cjs);
  const builder = require(cjs);
  return builder(readFileSync(path.join(dir, 'flight.wasm')));
}
const wc = await loadWitnessCalculator();

async function tryWitness(inp) {
  try {
    await wc.calculateWitness(inp, true); // sanityCheck → throws on any violated constraint
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e?.message ?? e).split('\n')[0] };
  }
}

// ── honest: full prove + verify against the committed VK ─────────────────────
{
  const t0 = Date.now();
  let ok = false;
  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      scenario.witness,
      path.join(buildDir, 'flight_js', 'flight.wasm'),
      path.join(buildDir, 'flight_final.zkey'),
    );
    ok = await snarkjs.groth16.verify(vk, publicSignals, proof);
  } catch (e) {
    line('FAIL', 'honest', `unexpected prove/verify error: ${String(e?.message ?? e).split('\n')[0]}`);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (ok) line('PASS', 'honest', `proof verifies vs verification_key.json (${secs}s)`);
  else {
    failures++;
    line('FAIL', 'honest', 'honest proof did NOT verify');
  }
}

// ── attacks: each must be rejected ───────────────────────────────────────────
for (const mode of ATTACK_MODES) {
  const bad = await applyAttack(mode, {
    scenario,
    droneSeedHex: DRONE_SEED_HEX,
    foreignSeedHex: (() => {
      const b = Buffer.from(DRONE_SEED_HEX, 'hex');
      b[0] ^= 0xff;
      return b.toString('hex');
    })(),
  });

  const w = await tryWitness(bad);
  if (!w.ok) {
    line('REJECTED', mode, `witness generation failed (${ATTACK_NOTES[mode]})`);
    continue;
  }
  // Extremely unlikely fallback: a witness was produced — the proof must still
  // fail to verify for the attack to count as rejected.
  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      bad,
      path.join(buildDir, 'flight_js', 'flight.wasm'),
      path.join(buildDir, 'flight_final.zkey'),
    );
    const accepts = await snarkjs.groth16.verify(vk, publicSignals, proof);
    if (accepts) {
      failures++;
      line('FAIL', mode, 'attack produced an ACCEPTING proof (security regression!)');
    } else {
      line('REJECTED', mode, 'proof verify == false');
    }
  } catch (e) {
    line('REJECTED', mode, `prove failed (${String(e?.message ?? e).split('\n')[0]})`);
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
