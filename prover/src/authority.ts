/**
 * authority.ts — airspace-authority CLI (DESIGN.md §11.2, §10.3; actor
 * "Issuer/authority").
 *
 * The regulator authors a straight-lane corridor and approves its Merkle root
 * on-chain, per lane, with a validity window. The registry later reads
 * `corridor(lane_id)` server-side and feeds the root into a flight proof's
 * public inputs (I1: roots come from contract storage, never tx args).
 *
 * Commands:
 *   author --lane <n> --from <lat,lon> --to <lat,lon> [--out corridor.json]
 *       Straight-lane RC-cell cover (64 samples, 8-neighbour buffering, dedupe,
 *       depth-12 PAD-filled tree, even index = left) — the SAME construction as
 *       prover/scripts/gen-flight-fixtures.mjs. Writes
 *       {lane_id, cells[decimal], root, from, to}. Deterministic: on the fixture
 *       lane params it reproduces circuits/fixtures/flight/corridor.json's root.
 *
 *   approve --corridor <file> [--valid-from <ts>] [--valid-to <ts>]
 *       Print (and, when AEGIS_AIRSPACE_ID is set, run) the invoke:
 *         stellar contract invoke --network testnet --source relay-authority \
 *           --id $AEGIS_AIRSPACE_ID -- approve_corridor \
 *           --lane_id <n> --root <decimal> --valid_from <ts> --valid_to <ts>
 *       (U256 root travels as a DECIMAL string — aegis-airspace approve_corridor.)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { authorCorridor, type Corridor } from './lib/flight.js';
import { buildInvoke, parseFlags, runInvoke, type InvokeArg } from './lib/contract.js';

/** Authority keystore name for `--source` (public role name, not a secret). */
const AUTHORITY_SOURCE = 'relay-authority';

/** Parse a "lat,lon" pair into decimal-degree strings. */
function parseLatLon(s: string, flag: string): { lat: string; lon: string } {
  const parts = s.split(',').map((x) => x.trim());
  if (parts.length !== 2 || parts.some((x) => x === '' || Number.isNaN(Number(x)))) {
    throw new Error(`--${flag} must be "<lat>,<lon>" (decimal degrees), got: ${s}`);
  }
  return { lat: parts[0], lon: parts[1] };
}

/**
 * approve_corridor(lane_id: u32, root: U256, valid_from: u64, valid_to: u64)
 *   --lane_id <n> --root <decimal> --valid_from <ts> --valid_to <ts>
 * Source = the authority (authority.require_auth()).
 */
export function buildApproveInvoke(args: {
  airspaceId: string;
  laneId: number | string;
  root: string;
  validFrom: number | string;
  validTo: number | string;
  source?: string;
}): string[] {
  const invokeArgs: InvokeArg[] = [
    ['lane_id', String(args.laneId)],
    ['root', BigInt(args.root).toString()],
    ['valid_from', String(args.validFrom)],
    ['valid_to', String(args.validTo)],
  ];
  return buildInvoke({
    fn: 'approve_corridor',
    args: invokeArgs,
    source: args.source ?? AUTHORITY_SOURCE,
    registryId: args.airspaceId,
  });
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdAuthor(flags: Record<string, string>): Promise<void> {
  if (!flags.lane || !flags.from || !flags.to) {
    throw new Error('usage: author --lane <n> --from <lat,lon> --to <lat,lon> [--out corridor.json]');
  }
  const laneId = Number(flags.lane);
  if (!Number.isInteger(laneId) || laneId < 0) throw new Error(`--lane must be a non-negative integer`);
  const from = parseLatLon(flags.from, 'from');
  const to = parseLatLon(flags.to, 'to');

  const corridor = await authorCorridor(laneId, from, to);
  const out = flags.out ?? 'corridor.json';
  writeFileSync(out, JSON.stringify(corridor, null, 2) + '\n');

  console.log(`Authored lane ${laneId} corridor (${corridor.cells.length} RC cells):`);
  console.log(`  from   = ${from.lat},${from.lon}`);
  console.log(`  to     = ${to.lat},${to.lon}`);
  console.log(`  root   = ${corridor.root}`);
  console.log(`Written: ${out}`);
}

async function cmdApprove(flags: Record<string, string>): Promise<void> {
  if (!flags.corridor) {
    throw new Error('usage: approve --corridor <file> [--valid-from <ts>] [--valid-to <ts>]');
  }
  const corridor = JSON.parse(readFileSync(flags.corridor, 'utf8')) as Corridor;
  if (corridor.lane_id === undefined || !corridor.root) {
    throw new Error(`${flags.corridor} is not a corridor file (missing lane_id/root)`);
  }

  // Default window: now .. now + 90 days (contract requires valid_from < valid_to).
  const now = Math.floor(Date.now() / 1000);
  const validFrom = flags['valid-from'] ? Number(flags['valid-from']) : now;
  const validTo = flags['valid-to'] ? Number(flags['valid-to']) : validFrom + 90 * 86400;
  if (!(validFrom < validTo)) throw new Error(`valid_from (${validFrom}) must be < valid_to (${validTo})`);

  const airspaceId = process.env.AEGIS_AIRSPACE_ID;
  const argv = buildApproveInvoke({
    airspaceId: airspaceId ?? 'AEGIS_AIRSPACE_ID',
    laneId: corridor.lane_id,
    root: corridor.root,
    validFrom,
    validTo,
  });

  console.log(`lane_id    = ${corridor.lane_id}`);
  console.log(`root       = ${BigInt(corridor.root).toString()}`);
  console.log(`valid_from = ${validFrom}`);
  console.log(`valid_to   = ${validTo}`);
  if (airspaceId) {
    console.log(`Submitting: ${argv.join(' ')}`);
    const res = runInvoke(argv);
    console.log(res.stdout.trim());
  } else {
    console.log('(AEGIS_AIRSPACE_ID unset — printing invoke, not submitting)');
    console.log(argv.join(' '));
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  switch (command) {
    case 'author':
      await cmdAuthor(flags);
      break;
    case 'approve':
      await cmdApprove(flags);
      break;
    default:
      console.error('authority commands: author | approve');
      process.exit(1);
  }
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  });
}
