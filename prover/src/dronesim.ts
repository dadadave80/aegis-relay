/**
 * dronesim.ts — drone simulator CLI (DESIGN.md §11.3, §8.3) — labeled honestly,
 * used adversarially. This is a SOFTWARE "secure element": it mints a Baby
 * Jubjub attestation key, flies a straight route, and emits a signed telemetry
 * log. Its attack modes ARE the demo — each MUST fail proof generation (witness
 * constraint violation) or on-chain verification. See docs/DESIGN.md §4 for what
 * the resulting proof does and does not mean.
 *
 * Commands:
 *   fly  --shipment <meta.json> | (--id <n> --cs-opening <file>)
 *        --corridor <corridor.json>
 *        [--key-seed <hex32> | env DRONE_SEED_HEX]
 *        [--pk-blind <n>] [--lane <n>] [--from <lat,lon> --to <lat,lon>]
 *        [--attack none|stray|teleport|gap|nonmono|splice|heavy|altitude|foreign-key]
 *        [--out <dir>]
 *      Generates the 16-waypoint log + A2 witness. Honest mode runs the §5.5
 *      pre-asserts; attack modes deliberately bypass them. Writes
 *      <out>/flight-log.json {waypoints, t[], d16, sig, drone_pk} and
 *      <out>/witness-input.json.
 *
 *   prove --log <dir>
 *      snarkjs groth16 fullProve with the LOCAL frozen zkey/wasm →
 *      <dir>/{proof,public}.json. For attack logs, witness generation is
 *      SUPPOSED to fail — surfaced as "REJECTED AT WITNESS GENERATION".
 *
 *   submit --id <n> [--log <dir>] [--registry <C...>]
 *      Build/print (run when AEGIS_REGISTRY_ID is set) the submit_flight invoke.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// circuits/build (flight_js + flight_final.zkey) lives at the repo root, two
// levels up from prover/src.
const CIRCUITS_BUILD = resolve(dirname(fileURLToPath(import.meta.url)), '../../circuits/build');

import {
  buildFlightScenario,
  applyAttack,
  deriveDroneKey,
  computeFlightDigest,
  ATTACK_MODES,
  ATTACK_NOTES,
  type AttackMode,
  type FlightWitness,
  type Corridor,
} from './lib/flight.js';
import { poseidonHash } from './lib/poseidon.js';
import {
  buildInvoke,
  parseFlags,
  proofToInvokeJson,
  resolveRegistryId,
  runInvoke,
  SOURCE,
  type InvokeArg,
} from './lib/contract.js';
import type { SnarkjsProof } from './lib/bn254.js';

const BANNER =
  'SIMULATED drone secure element — the proof binds a signing key, not physics. See DESIGN §4.';

// Frozen demo log shape (parity with gen-flight-fixtures.mjs); overridable.
const DEFAULT_T0 = 1_800_000_000n;
const DEFAULT_DT = 20n;
const DEFAULT_ALT_DM = 800n;

// ── Shipment loading ──────────────────────────────────────────────────────────

interface RawOpening {
  sku_hash?: string;
  /** sku raw id — hashed to sku_hash if sku_hash is absent. */
  sku?: string | number;
  qty: string | number;
  weight_g: string | number;
  value_units: string | number;
  recipient_pk_x: string;
  recipient_pk_y: string;
  method: string | number;
  deadline_ts: string | number;
  shipment_secret: string;
}

interface ShipmentMeta {
  shipment_id: string | number;
  lane_id?: number;
  pk_blind?: string | number;
  opening: RawOpening;
  from?: { lat: string | number; lon: string | number };
  to?: { lat: string | number; lon: string | number };
  t0?: string | number;
  dt?: string | number;
  alt_dm?: string | number;
}

async function resolveSkuHash(o: RawOpening): Promise<string> {
  if (o.sku_hash) return String(o.sku_hash);
  if (o.sku !== undefined) return poseidonHash([BigInt(o.sku)]);
  throw new Error('opening needs sku_hash (or sku to hash)');
}

/** Load the shipment either from a --shipment meta file or inline flags. */
function loadShipment(flags: Record<string, string>): ShipmentMeta {
  if (flags.shipment) {
    return JSON.parse(readFileSync(flags.shipment, 'utf8')) as ShipmentMeta;
  }
  if (!flags.id || !flags['cs-opening']) {
    throw new Error('provide --shipment <meta.json>, or --id <n> --cs-opening <file>');
  }
  const opening = JSON.parse(readFileSync(flags['cs-opening'], 'utf8')) as RawOpening;
  return {
    shipment_id: flags.id,
    pk_blind: flags['pk-blind'],
    lane_id: flags.lane ? Number(flags.lane) : undefined,
    opening,
  };
}

function parseLatLon(s: string): { lat: string; lon: string } {
  const [lat, lon] = s.split(',').map((x) => x.trim());
  if (lat === undefined || lon === undefined) throw new Error(`bad lat,lon: ${s}`);
  return { lat, lon };
}

function droneSeedHex(flags: Record<string, string>): string {
  const seed = flags['key-seed'] ?? process.env.DRONE_SEED_HEX;
  if (!seed) throw new Error('drone key seed required: --key-seed <hex32> or env DRONE_SEED_HEX');
  if (!/^[0-9a-fA-F]{64}$/.test(seed)) throw new Error('--key-seed must be 32 bytes (64 hex chars)');
  return seed.toLowerCase();
}

/** Foreign (non-custodian) seed for the foreign-key attack: drone seed, first byte flipped. */
function foreignSeedHex(seedHex: string): string {
  const b = Buffer.from(seedHex, 'hex');
  b[0] ^= 0xff;
  return b.toString('hex');
}

// ── fly ───────────────────────────────────────────────────────────────────────

/** Build the flight-log artifact {waypoints, t[], d16, sig, drone_pk} from a witness. */
async function flightLogFromWitness(w: FlightWitness): Promise<unknown> {
  const lat = w.lat_q as string[];
  const lon = w.lon_q as string[];
  const alt = w.alt_dm as string[];
  const t = w.t as string[];
  const waypoints = lat.map((_, i) => ({ lat_q: lat[i], lon_q: lon[i], alt_dm: alt[i] }));
  const d16 = await computeFlightDigest(w.shipment_id as string, {
    lat_q: lat,
    lon_q: lon,
    alt_dm: alt,
    t,
  });
  return {
    _note: BANNER,
    shipment_id: w.shipment_id,
    waypoints,
    t,
    d16,
    sig: { R8x: w.sig_R8x, R8y: w.sig_R8y, S: w.sig_S },
    drone_pk: { x: w.pk_x, y: w.pk_y, pk_blind: w.pk_blind },
  };
}

async function cmdFly(flags: Record<string, string>): Promise<void> {
  const attack = (flags.attack ?? 'none') as AttackMode;
  if (attack !== 'none' && !ATTACK_MODES.includes(attack)) {
    throw new Error(`unknown --attack ${attack}; one of none|${ATTACK_MODES.join('|')}`);
  }

  const shipment = loadShipment(flags);
  const seedHex = droneSeedHex(flags);

  // Corridor file supplies the lane, endpoints (unless overridden), and the
  // approved root we cross-check against.
  let corridorFile: Corridor | undefined;
  if (flags.corridor) corridorFile = JSON.parse(readFileSync(flags.corridor, 'utf8')) as Corridor;

  const fromStr = flags.from ? parseLatLon(flags.from) : shipment.from ?? corridorFile?.from;
  const toStr = flags.to ? parseLatLon(flags.to) : shipment.to ?? corridorFile?.to;
  if (!fromStr || !toStr) {
    throw new Error('endpoints unknown: pass --from/--to, or put from/to in the shipment or corridor file');
  }
  const laneId =
    (flags.lane ? Number(flags.lane) : undefined) ??
    shipment.lane_id ??
    corridorFile?.lane_id;
  if (laneId === undefined) throw new Error('lane unknown: pass --lane or use a corridor file with lane_id');

  const pkBlind = flags['pk-blind'] ?? shipment.pk_blind;
  if (pkBlind === undefined) throw new Error('pk_blind unknown: pass --pk-blind or put it in the shipment');

  const droneKey = await deriveDroneKey(seedHex, BigInt(pkBlind));
  const o = shipment.opening;

  const scenario = await buildFlightScenario({
    shipmentId: shipment.shipment_id,
    opening: {
      skuHash: await resolveSkuHash(o),
      qty: BigInt(o.qty),
      weightG: BigInt(o.weight_g),
      valueUnits: BigInt(o.value_units),
      recipientPkX: o.recipient_pk_x,
      recipientPkY: o.recipient_pk_y,
      method: BigInt(o.method),
      deadlineTs: BigInt(o.deadline_ts),
      shipmentSecret: o.shipment_secret,
    },
    from: fromStr,
    to: toStr,
    droneKey,
    laneId,
    t0: shipment.t0 ? BigInt(shipment.t0) : DEFAULT_T0,
    dt: shipment.dt ? BigInt(shipment.dt) : DEFAULT_DT,
    altDm: shipment.alt_dm ? BigInt(shipment.alt_dm) : DEFAULT_ALT_DM,
  });

  // Cross-check the recomputed corridor root against the approved corridor.
  if (corridorFile && corridorFile.root !== scenario.corridor.root) {
    throw new Error(
      `corridor root mismatch: this flight's cover root ${scenario.corridor.root} != approved ${corridorFile.root}. ` +
        `Endpoints (${fromStr.lat},${fromStr.lon})→(${toStr.lat},${toStr.lon}) do not match the approved lane.`,
    );
  }

  const witness = await applyAttack(attack, {
    scenario,
    droneSeedHex: seedHex,
    foreignSeedHex: foreignSeedHex(seedHex),
  });

  const outDir = flags.out ?? join('out', 'flights', `ship-${shipment.shipment_id}-${attack}`);
  mkdirSync(outDir, { recursive: true });
  const witnessPath = join(outDir, 'witness-input.json');
  const logPath = join(outDir, 'flight-log.json');
  writeFileSync(witnessPath, JSON.stringify(witness, null, 2) + '\n');
  writeFileSync(logPath, JSON.stringify(await flightLogFromWitness(witness), null, 2) + '\n');

  console.log(`attack mode : ${attack} — ${ATTACK_NOTES[attack]}`);
  console.log(`corridor    : lane ${laneId}, root ${scenario.corridor.root}`);
  console.log(`drone_pk    : (${droneKey.pkX}, ${droneKey.pkY})`);
  console.log(`Written: ${witnessPath}`);
  console.log(`Written: ${logPath}`);
  if (attack !== 'none') {
    console.log(`NOTE: '${attack}' is an ATTACK log — proving it MUST be rejected (that is the test).`);
  }
}

// ── prove ─────────────────────────────────────────────────────────────────────

async function cmdProve(flags: Record<string, string>): Promise<void> {
  if (!flags.log) throw new Error('usage: prove --log <dir>');
  const dir = flags.log;
  const witnessPath = join(dir, 'witness-input.json');
  if (!existsSync(witnessPath)) throw new Error(`no witness-input.json in ${dir} (run fly first)`);
  const witness = JSON.parse(readFileSync(witnessPath, 'utf8')) as FlightWitness;

  const wasm = join(CIRCUITS_BUILD, 'flight_js', 'flight.wasm');
  const zkey = join(CIRCUITS_BUILD, 'flight_final.zkey');
  if (!existsSync(wasm) || !existsSync(zkey)) {
    throw new Error(`missing proving artifacts:\n  ${wasm}\n  ${zkey}\n(circuits/build is gitignored)`);
  }

  const { groth16 } = await import('snarkjs');
  console.log('Proving A2 flight (snarkjs groth16 fullProve)…');
  let proof: SnarkjsProof;
  let publicSignals: string[];
  try {
    const res = await groth16.fullProve(witness, wasm, zkey);
    proof = res.proof as SnarkjsProof;
    publicSignals = res.publicSignals as string[];
  } catch (e) {
    // Expected outcome for every attack mode: a violated constraint aborts
    // witness generation. Surface it clearly — this is a REJECTION, not a crash.
    console.error('REJECTED AT WITNESS GENERATION (constraint violated)');
    console.error(`  ${String(e instanceof Error ? e.message : e).split('\n')[0]}`);
    process.exit(2);
  }

  const proofPath = join(dir, 'proof.json');
  const publicPath = join(dir, 'public.json');
  writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n');
  writeFileSync(publicPath, JSON.stringify(publicSignals, null, 2) + '\n');
  console.log('ACCEPTED — witness satisfied all constraints, proof generated.');
  console.log(`Written: ${proofPath}`);
  console.log(`Written: ${publicPath}`);
  console.log(`public [shipment_id,c_s,head,corridor_root,t_0,t_n]: ${JSON.stringify(publicSignals)}`);
}

// ── submit ──────────────────────────────────────────────────────────────────

/**
 * submit_flight(id: u64, proof: Proof, t_0: u64, t_n: u64)
 *   --id <n> --proof '{"a":..,"b":..,"c":..}' --t_0 <ts> --t_n <ts>
 * corridor_root / c_s / head come from contract storage (I1) — not tx args.
 * Permissionless on-chain; the source only pays the fee.
 */
export function buildSubmitFlightInvoke(args: {
  registryId: string;
  id: string;
  proof: SnarkjsProof;
  t0: string;
  tN: string;
  source?: string;
}): string[] {
  const invokeArgs: InvokeArg[] = [
    ['id', args.id],
    ['proof', JSON.stringify(proofToInvokeJson(args.proof))],
    ['t_0', args.t0],
    ['t_n', args.tN],
  ];
  return buildInvoke({
    fn: 'submit_flight',
    args: invokeArgs,
    source: args.source ?? SOURCE.carrier,
    registryId: args.registryId,
  });
}

async function cmdSubmit(flags: Record<string, string>): Promise<void> {
  if (!flags.id) throw new Error('usage: submit --id <n> [--log <dir>] [--registry <C...>]');
  const dir = flags.log ?? join('out', 'flights', `ship-${flags.id}-none`);
  const proof = JSON.parse(readFileSync(join(dir, 'proof.json'), 'utf8')) as SnarkjsProof;
  const publicSignals = JSON.parse(readFileSync(join(dir, 'public.json'), 'utf8')) as string[];
  // public order: [shipment_id, c_s, head, corridor_root, t_0, t_n]
  const t0 = BigInt(publicSignals[4]).toString();
  const tN = BigInt(publicSignals[5]).toString();

  const registryId = resolveRegistryId(flags.registry);
  const argv = buildSubmitFlightInvoke({
    registryId: registryId ?? 'AEGIS_REGISTRY_ID',
    id: String(flags.id),
    proof,
    t0,
    tN,
  });
  if (registryId) {
    console.log(`Submitting: ${argv.join(' ')}`);
    const res = runInvoke(argv);
    console.log(res.stdout.trim());
  } else {
    console.log('(AEGIS_REGISTRY_ID unset — printing invoke, not submitting)');
    console.log(argv.join(' '));
  }
}

async function main(): Promise<void> {
  console.log(BANNER);
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  switch (command) {
    case 'fly':
      await cmdFly(flags);
      break;
    case 'prove':
      await cmdProve(flags);
      break;
    case 'submit':
      await cmdSubmit(flags);
      break;
    default:
      console.error('dronesim commands: fly | prove | submit');
      process.exit(1);
  }
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main()
    // snarkjs fullProve leaves worker threads alive, which would keep the
    // process hanging after a successful `prove`; force a clean exit.
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(String(e instanceof Error ? e.message : e));
      process.exit(1);
    });
}
